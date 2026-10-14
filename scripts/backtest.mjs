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
const MODELS = { A:modelA, B:modelB };

function outcome(m){ return m.hg>m.ag?0:m.hg===m.ag?1:2; }

export function evaluate(matches){
  matches=[...matches].filter(m=>m.hg!=null).sort((x,y)=>x.date<y.date?-1:1);
  const st={ n:0,hg:0,ag:0,t:{} };
  const tt=id=>st.t[id]||(st.t[id]={n:0,gf:0,ga:0});
  const acc={}; const names=[...Object.keys(MODELS),'base'];
  names.forEach(k=>acc[k]={n:0,hit:0,brier:0,ll:0,o25:0,bins:Array.from({length:10},()=>({n:0,pred:0,real:0}))});
  let base=[1/3,1/3,1/3];
  for(const m of matches){
    const H=tt(m.h), A=tt(m.a);
    if(H.n>=MIN_GAMES && A.n>=MIN_GAMES){
      const y=outcome(m), over=(m.hg+m.ag)>=3?1:0;
      const preds={ base:{p:base,o25:0.5}};
      for(const [k,f] of Object.entries(MODELS)) preds[k]=f(st,m.h,m.a);
      for(const k of names){
        const {p,o25}=preds[k], r=acc[k]; r.n++;
        r.hit += (p.indexOf(Math.max(...p))===y)?1:0;
        r.brier += p.reduce((s,pi,i)=>s+(pi-(i===y?1:0))**2,0);
        r.ll += -Math.log(Math.max(1e-9,p[y]));
        r.o25 += (o25-over)**2;
        const b=Math.min(9,Math.floor(p[0]*10)); r.bins[b].n++; r.bins[b].pred+=p[0]; r.bins[b].real+=(y===0?1:0);
      }
    }
    // actualizar historial DESPUÉS de predecir
    H.n++; H.gf+=m.hg; H.ga+=m.ag; A.n++; A.gf+=m.ag; A.ga+=m.hg; st.n++; st.hg+=m.hg; st.ag+=m.ag;
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
  for(const [k,r] of Object.entries(acc)) s[k]={ partidos:r.n, aciertos:+(100*r.hit/r.n).toFixed(1), brier:+(r.brier/r.n).toFixed(4), logloss:+(r.ll/r.n).toFixed(4), brier_mas25:+(r.o25/r.n).toFixed(4),
    calibracion_local:r.bins.filter(b=>b.n>=15).map((b,i)=>({ predicho:+(100*b.pred/b.n).toFixed(0), real:+(100*b.real/b.n).toFixed(0), n:b.n })) };
  return s;
}

async function main(){
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
  if(!parts.length){ console.error('Sin datos para evaluar'); process.exit(1); }
  const total=summarize(merge(parts));
  console.log('\nRESULTADO TOTAL (menos Brier y logloss = mejor; más aciertos = mejor)');
  console.table(Object.fromEntries(Object.entries(total).map(([k,v])=>[k,{partidos:v.partidos,aciertos_pct:v.aciertos,brier:v.brier,logloss:v.logloss,brier_mas25:v.brier_mas25}])));
  console.log('Calibración de "gana el local" (predicho % vs real %):'); for(const k of ['A','B']) console.log(k, total[k].calibracion_local.map(b=>`${b.predicho}→${b.real}(n=${b.n})`).join('  '));
  fs.writeFileSync(new URL('../backtest.json',import.meta.url), JSON.stringify({generado:now.toISOString(),total,detalle:detail},null,1));
}
if (process.argv[1]===fileURLToPath(import.meta.url)) main();
