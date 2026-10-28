// Prueba del modelo de predicción contra partidos ya jugados (walk-forward):
// para cada partido, el modelo solo usa lo que había pasado ANTES de ese partido.
// Compara el modelo actual (A) con uno mejorado (B) y con una línea base.
// Uso: FOOTBALL_DATA_KEY=tu_clave node scripts/backtest.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const COMPS = { epl:'PL', esp:'PD', ita:'SA', ger:'BL1', fra:'FL1' };
const MIN_GAMES = 5;   // no se evalúa un partido hasta que cada equipo jugó al menos 5

function pois(k,l){ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; }
export function grid(lh,la){
  let ph=0,px=0,pa=0,o25=0;
  for(let i=0;i<=10;i++) for(let j=0;j<=10;j++){ const p=pois(i,lh)*pois(j,la); if(i>j) ph+=p; else if(i===j) px+=p; else pa+=p; if(i+j>=3) o25+=p; }
  const t=ph+px+pa; return { p:[ph/t,px/t,pa/t], o25 };
}

// Modelo A: el que usa hoy el sitio (goles por partido crudos, ventaja local 10 %).
export function modelA(st, h, a){
  const H=st.t[h], A=st.t[a];
  const lh=1.1*((H.gf/H.n)+(A.ga/A.n))/2, la=((A.gf/A.n)+(H.ga/H.n))/2;
  return grid(lh,la);
}
// Modelo B: fuerza de ataque/defensa relativa al promedio de la liga, con "encogimiento"
// hacia el promedio cuando hay pocos partidos, y ventaja local medida en la propia liga.
export function modelB(st, h, a, k=6){
  const mh = st.n>=20 ? st.hg/st.n : 1.5, ma = st.n>=20 ? st.ag/st.n : 1.2;   // goles locales y visitantes promedio
  const avg=(mh+ma)/2;
  const str=t=>{ const T=st.t[t]; return { att:((T.gf+k*avg)/(T.n+k))/avg, def:((T.ga+k*avg)/(T.n+k))/avg }; };
  const H=str(h), A=str(a);
  return grid(mh*H.att*A.def, ma*A.att*H.def);
}

// Modelo C (Elo): cada equipo tiene un puntaje que sube y baja con cada resultado (cuenta la diferencia de gol).
// Con eso se estima quién gana y cuánto empate. Necesita varias temporadas para arrancar bien.
const ELO_START=1500, ELO_K=20, ELO_HOME=60;
const eloOf=(st,t)=>(st.elo&&st.elo[t])??ELO_START;
// Forma de local/visitante: % de victorias de el local en sus últimos 5 partidos de local y de el visitante en sus últimos 5 de visitante.
// El que tenga mejor porcentaje recibe tantos puntos de Elo como su porcentaje (60 % = +60). Si empatan o falta historial (menos de 5), no suma nada. FORM_K=0 lo apaga.
export const FORM_N=5, FORM_K=process.env.FORM_K!==undefined?+process.env.FORM_K:0;   // 0 = apagado (el Elo queda como estaba); FORM_K=1 aplica la regla completa, para comparar en el backtest
export const winPct=(L)=>L&&L.length>=FORM_N?L.slice(-FORM_N).reduce((s,x)=>s+(x===1?1:0),0)/FORM_N:null;
export function formBonus(st,h,a){
  const F=st.fm||{}, hw=winPct(F[h]&&F[h].h), aw=winPct(F[a]&&F[a].a);
  if(hw==null||aw==null||hw===aw||!FORM_K) return [0,0];
  return hw>aw?[100*hw*FORM_K,0]:[0,100*aw*FORM_K];
}
export function modelElo(st,h,a,noForm){
  const [bh,ba]=noForm?[0,0]:formBonus(st,h,a);
  const E=1/(1+10**(-(eloOf(st,h)+bh+ELO_HOME-eloOf(st,a)-ba)/400));
  const pd=0.28*Math.exp(-1.5*(2*E-1)**2);
  const ph=Math.max(.01,E-pd/2), pa=Math.max(.01,1-E-pd/2), t=ph+pd+pa;
  return { p:[ph/t,pd/t,pa/t], o25:0.5 };
}
export function eloUpdate(st,m){
  if(!st.elo) return;
  const rh=eloOf(st,m.h), ra=eloOf(st,m.a), E=1/(1+10**(-(rh+ELO_HOME-ra)/400));
  const S=m.hg>m.ag?1:m.hg===m.ag?.5:0, gd=Math.abs(m.hg-m.ag), mult=gd<=1?1:Math.log(gd)+1.6;
  const d=ELO_K*mult*(S-E); st.elo[m.h]=rh+d; st.elo[m.a]=ra-d;
}
// Mercado: las cuotas de las casas de apuestas, sin el margen. Es la vara más difícil de superar.
export function modelMarket(st,h,a,m){
  if(!m||!m.odds) return null;
  const inv=m.odds.map(o=>1/o), t=inv.reduce((x,y)=>x+y,0);
  let o25=0.5; if(m.ou){ const ov=1/m.ou[0], un=1/m.ou[1]; o25=ov/(ov+un); }
  return { p:inv.map(x=>x/t), o25 };
}

// Modelo X: como B, pero la fuerza de cada equipo mezcla los goles reales con un "xG casero" sacado de los remates
// (30 % por remate al arco y 4 % por remate afuera, reescalado para que el total coincida con los goles de la liga).
// Los goles tienen mucha suerte; los remates son más estables.
export const xgp=(shots,sot)=>0.30*sot+0.04*Math.max(0,shots-sot);
export function modelX(st,h,a,k=6){
  const mh = st.n>=20 ? st.hg/st.n : 1.5, ma = st.n>=20 ? st.ag/st.n : 1.2, avg=(mh+ma)/2;
  const sc = st.xg && st.xg.den>0 ? st.xg.goals/st.xg.den : 1;
  const str=t=>{ const T=st.t[t]; const gf=.5*T.gf+.5*T.xf*sc, ga=.5*T.ga+.5*T.xa*sc;
    return { att:((gf+k*avg)/(T.n+k))/avg, def:((ga+k*avg)/(T.n+k))/avg }; };
  const H=str(h), A=str(a);
  return grid(mh*H.att*A.def, ma*A.att*H.def);
}
// Modelo D: promedio de X (goles + remates) y Elo. Modelo E: D con las probabilidades "estiradas o achicadas"
// según lo que se vio en los partidos anteriores (temperatura T; T>1 afina a los favoritos, T<1 los modera).
export const blend=(a,b,w=.5)=>{ const p=a.p.map((x,i)=>w*x+(1-w)*b.p[i]); return { p, o25:a.o25 }; };
export const temper=(pr,T)=>{ const q=pr.p.map(x=>Math.max(1e-9,x)**T), t=q.reduce((x,y)=>x+y,0); return { p:q.map(x=>x/t), o25:pr.o25 }; };
export function fitT(hist){
  let best=1, bl=Infinity;
  for(let T=0.6;T<=1.8001;T+=0.05){ let l=0; for(const [p,y] of hist){ const q=p.map(x=>Math.max(1e-9,x)**T), t=q[0]+q[1]+q[2]; l-=Math.log(q[y]/t); } if(l<bl){bl=l;best=T;} }
  return best;
}
// Estado de una liga-temporada: lo que el modelo "sabe" hasta ahora. learn() lo actualiza con un partido ya jugado.
export const newState=elo=>({ n:0,hg:0,ag:0,ns:0,hsot:0,asot:0,t:{},elo:elo||{} });
export const teamOf=(st,id)=>st.t[id]||(st.t[id]={n:0,gf:0,ga:0,xf:0,xa:0,ns:0,sf:0,sa:0});
export function learn(st,m){
  const H=teamOf(st,m.h), A=teamOf(st,m.a);
  eloUpdate(st,m);
  { const F=st.fm||(st.fm={}); ((F[m.h]=F[m.h]||{h:[],a:[]}).h).push(m.hg>m.ag?1:m.hg===m.ag?.5:0); ((F[m.a]=F[m.a]||{h:[],a:[]}).a).push(m.ag>m.hg?1:m.hg===m.ag?.5:0); }   // 1 victoria, 0.5 empate, 0 derrota (el % solo cuenta victorias)
  const hasS=m.hs!=null&&m.hst!=null&&m.as!=null&&m.ast!=null, sc=st.xg&&st.xg.den>0?st.xg.goals/st.xg.den:1;
  const xh=hasS?xgp(m.hs,m.hst):m.hg/sc, xa=hasS?xgp(m.as,m.ast):m.ag/sc;
  H.xf+=xh; H.xa+=xa; A.xf+=xa; A.xa+=xh;
  if(hasS){ const g=st.xg||(st.xg={goals:0,den:0}); g.goals+=m.hg+m.ag; g.den+=xh+xa;
    H.ns++; A.ns++; H.sf+=m.hst; H.sa+=m.ast; A.sf+=m.ast; A.sa+=m.hst; st.ns++; st.hsot+=m.hst; st.asot+=m.ast; }   // remates al arco a favor y en contra
  H.n++; H.gf+=m.hg; H.ga+=m.ag; A.n++; A.gf+=m.ag; A.ga+=m.hg; st.n++; st.hg+=m.hg; st.ag+=m.ag;
}
// Modelo D listo para usar: probabilidades [local, empate, visita] en 0..1.
// Para decir quién es favorito pesa más el Elo (que ya mide la calidad de los rivales enfrentados): 70 % Elo y 30 % goles + remates.
export const W_X=0.3;
export const modelD=(st,h,a)=>{ teamOf(st,h); teamOf(st,a); return blend(modelX(st,h,a),modelElo(st,h,a),W_X); };
const MODELS = { X:(st,h,a)=>modelX(st,h,a), A:(st,h,a)=>modelA(st,h,a), B:(st,h,a)=>modelB(st,h,a), C:(st,h,a)=>modelElo(st,h,a), mercado:modelMarket };

function outcome(m){ return m.hg>m.ag?0:m.hg===m.ag?1:2; }

export function evaluate(matches, ctx={}){
  matches=[...matches].filter(m=>m.hg!=null).sort((x,y)=>x.date<y.date?-1:1);
  const st=newState(ctx.elo), tt=id=>teamOf(st,id);
  const acc={}; const names=[...Object.keys(MODELS),'D','E','F','Dsin','base'];
  const cal=ctx.cal||(ctx.cal={ hist:[], T:1 });
  names.forEach(k=>acc[k]={n:0,hit:0,brier:0,ll:0,o25:0,bins:Array.from({length:10},()=>({n:0,pred:0,real:0}))});
  let base=[1/3,1/3,1/3];
  for(const m of matches){
    const H=tt(m.h), A=tt(m.a);
    if(H.n>=MIN_GAMES && A.n>=MIN_GAMES){
      const y=outcome(m), over=(m.hg+m.ag)>=3?1:0;
      const preds={ base:{p:base,o25:0.5}};
      for(const [k,f] of Object.entries(MODELS)) preds[k]=f(st,m.h,m.a,m);
      preds.D=blend(preds.X,preds.C); preds.F=blend(preds.X,preds.C,W_X); preds.Dsin=blend(preds.X,modelElo(st,m.h,m.a,true),W_X); preds.E=temper(preds.D,cal.T);
      cal.hist.push([preds.D.p,y]); if(cal.hist.length>=200 && cal.hist.length%100===0) cal.T=fitT(cal.hist);
      const comparable = !ctx.needOdds || m.odds;                  // con historial: todos se miden en los mismos partidos (los que tienen cuotas)
      for(const k of (comparable?names:[])){
        if(!preds[k]) continue;                                   // p. ej. 'mercado' sin cuotas
        const {p,o25}=preds[k], r=acc[k]; r.n++;
        r.hit += (p.indexOf(Math.max(...p))===y)?1:0;
        r.brier += p.reduce((s,pi,i)=>s+(pi-(i===y?1:0))**2,0);
        r.ll += -Math.log(Math.max(1e-9,p[y]));
        r.o25 += (o25-over)**2;
        const b=Math.min(9,Math.floor(p[0]*10)); r.bins[b].n++; r.bins[b].pred+=p[0]; r.bins[b].real+=(y===0?1:0);
      }
    }
    // actualizar historial DESPUÉS de predecir
    learn(st,m);
    const y=outcome(m); const c=st.cnt||(st.cnt=[0,0,0]); c[y]++; if(st.n>=30) base=c.map(v=>v/st.n);   // línea base: frecuencia histórica de 1/X/2
  }
  return acc;
}

function merge(list){            // junta resultados de varias ligas/temporadas
  const out={};
  for(const acc of list) for(const [k,r] of Object.entries(acc)){
    const o=out[k]||(out[k]={n:0,hit:0,brier:0,ll:0,o25:0,bins:Array.from({length:10},()=>({n:0,pred:0,real:0}))});
    o.n+=r.n;o.hit+=r.hit;o.brier+=r.brier;o.ll+=r.ll;o.o25+=r.o25; r.bins.forEach((b,i)=>{o.bins[i].n+=b.n;o.bins[i].pred+=b.pred;o.bins[i].real+=b.real;});
  }
  return out;
}
export function summarize(acc){
  const s={};
  for(const [k,r] of Object.entries(acc)) if(r.n) s[k]={ partidos:r.n, aciertos:+(100*r.hit/r.n).toFixed(1), brier:+(r.brier/r.n).toFixed(4), logloss:+(r.ll/r.n).toFixed(4), brier_mas25:+(r.o25/r.n).toFixed(4),
    calibracion_local:r.bins.filter(b=>b.n>=15).map((b,i)=>({ predicho:+(100*b.pred/b.n).toFixed(0), real:+(100*b.real/b.n).toFixed(0), n:b.n })) };
  return s;
}

// Con history.json (football-data.co.uk): varias temporadas, sin límite de pedidos y con cuotas del mercado.
function fromHistory(file){
  const H=JSON.parse(fs.readFileSync(file,'utf8')), parts=[], detail={}, byL={};
  for(const r of H.partidos){ const [lg,se,date,h,a,hg,ag,o1,o2,o3,u1,u2,hs,as_,hst,ast]=r;
    const m={h,a,date,hg,ag,hs,as:as_,hst,ast}; if(o1) m.odds=[o1,o2,o3]; if(u1) m.ou=[u1,u2];
    ((byL[lg]=byL[lg]||{})[se]=byL[lg][se]||[]).push(m); }
  for(const [lg,seasons] of Object.entries(byL)){
    const ctx={ elo:{}, needOdds:true, cal:{ hist:[], T:1 } };
    for(const se of Object.keys(seasons).sort()){
      for(const t of Object.keys(ctx.elo)) ctx.elo[t]=1500+0.75*(ctx.elo[t]-1500);   // al empezar cada temporada, vuelven un poco al promedio
      const acc=evaluate(seasons[se],ctx); parts.push(acc); detail[`${lg}-${se}`]=summarize(acc);
      console.log(`${lg} ${se}: ${seasons[se].length} partidos, evaluados ${acc.A.n}`);
    }
  }
  return { parts, detail, fuente:'football-data.co.uk' };
}

async function main(){
  const histFile=new URL('../history.json',import.meta.url);
  if(fs.existsSync(histFile)){
    const { parts, detail, fuente }=fromHistory(histFile);
    return report(parts, detail, fuente);
  }
  const key=process.env.FOOTBALL_DATA_KEY; if(!key){ console.error('Falta FOOTBALL_DATA_KEY'); process.exit(1); }
  const api=async p=>{ await new Promise(r=>setTimeout(r,7000)); const res=await fetch('https://api.football-data.org/v4'+p,{headers:{'X-Auth-Token':key}}); if(!res.ok) throw new Error(p+' -> '+res.status); return res.json(); };
  const now=new Date(); const cur=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1;
  const parts=[], detail={};
  for(const [id,code] of Object.entries(COMPS)) for(const yr of [cur,cur-1,cur-2]){
    try{
      const r=await api(`/competitions/${code}/matches?season=${yr}&status=FINISHED`);
      const ms=r.matches.map(m=>({h:m.homeTeam.id,a:m.awayTeam.id,date:m.utcDate,hg:m.score.fullTime.home,ag:m.score.fullTime.away}));
      const acc=evaluate(ms); parts.push(acc); detail[`${id}-${yr}`]=summarize(acc);
      console.log(`${id} ${yr}: ${ms.length} partidos, evaluados ${acc.A.n}`);
    }catch(e){ console.warn(`${id} ${yr}: omitido (${e.message})`); }
  }
  return report(parts, detail, 'api.football-data.org');
}
function report(parts, detail, fuente){
  if(!parts.length){ console.error('Sin datos para evaluar'); process.exit(1); }
  const total=summarize(merge(parts));
  console.log('\nRESULTADO TOTAL (menos Brier y logloss = mejor; más aciertos = mejor)');
  console.table(Object.fromEntries(Object.entries(total).map(([k,v])=>[k,{partidos:v.partidos,aciertos_pct:v.aciertos,brier:v.brier,logloss:v.logloss,brier_mas25:v.brier_mas25}])));
  console.log('Calibración de "gana el local" (predicho % vs real %):'); for(const k of Object.keys(total)) console.log(k, total[k].calibracion_local.map(b=>`${b.predicho}→${b.real}(n=${b.n})`).join('  '));
  fs.writeFileSync(new URL('../backtest.json',import.meta.url), JSON.stringify({generado:new Date().toISOString(),fuente,total,detalle:detail},null,1));
}
if (process.argv[1]===fileURLToPath(import.meta.url)) main();
