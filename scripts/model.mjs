// Modelo D para el sitio: promedio de "goles + remates" (X) y Elo, probado en backtest.mjs contra ~6.000 partidos.
// Se alimenta de history.json (football-data.co.uk). Si algo falta, devuelve null y el sitio usa el modelo simple de siempre.
import fs from 'node:fs';
import { newState, learn, modelD, winPct, FORM_K } from './backtest.mjs';
const MIN_GAMES=5;
const eloNow=(st,t)=>(st.elo&&st.elo[t])??1500;
const pz=(k,l)=>{ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; };
// Goles esperados: promedio de los ÚLTIMOS 5 partidos de cada equipo (cualquier competición), mezclado con el promedio de la temporada (60 % reciente, 40 % temporada).
// fa y fb = listas de [golesAFavor, golesEnContra] de los últimos 5; sa y sb = [golesAFavorPorPartido, golesEnContraPorPartido] de la temporada (o null).
// Devuelve null si a alguno le faltan partidos (hacen falta 5). o25 y bt en %, lA y lB en goles.
export const W_RECENT=process.env.W_RECENT!==undefined?+process.env.W_RECENT:0.6;
export function goalsExp(fa,fb,sa,sb,x=null,conv=0.31){
  if(!fa||!fb||fa.length<5||fb.length<5) return null;
  fa=fa.slice(0,5); fb=fb.slice(0,5);
  const av=(L,i)=>L.reduce((s,x)=>s+x[i],0)/L.length;
  let lA=(av(fa,0)+av(fb,1))/2, lB=(av(fb,0)+av(fa,1))/2;
  if(sa&&sb&&sa.every(Number.isFinite)&&sb.every(Number.isFinite)){ lA=W_RECENT*lA+(1-W_RECENT)*(sa[0]+sb[1])/2; lB=W_RECENT*lB+(1-W_RECENT)*(sb[0]+sa[1])/2; }
  [lA,lB]=adjustGoals(lA,lB,x,conv);
  const lt=lA+lB, o25=1-(pz(0,lt)+pz(1,lt)+pz(2,lt)), bt=(1-Math.exp(-lA))*(1-Math.exp(-lB));
  return [Math.round(o25*1000)/10, Math.round(bt*1000)/10, Math.round(lA*100)/100, Math.round(lB*100)/100];
}
// Ajuste de los goles esperados con remates al arco y Elo:
//  - remates: se mezcla (W_SHOTS) con los goles que salen de los remates al arco esperados (últimos 10 de local del local y últimos 10 de visitante del visitante) × goles por remate al arco.
//  - Elo: cuanto más pareja la diferencia de Elo, menos se toca; un partido muy desparejo suma hasta ELO_G (8 %) de goles. Es una constante a probar con el backtest.
export const W_SHOTS=process.env.W_SHOTS!==undefined?+process.env.W_SHOTS:0.3;
export const ELO_G=process.env.ELO_G!==undefined?+process.env.ELO_G:0.08;
export function adjustGoals(lA,lB,x,conv){
  if(!x) return [lA,lB];
  if(x.sot&&x.sot.every(Number.isFinite)&&conv>0&&W_SHOTS>0){ lA=(1-W_SHOTS)*lA+W_SHOTS*x.sot[0]*conv; lB=(1-W_SHOTS)*lB+W_SHOTS*x.sot[1]*conv; }
  if(Number.isFinite(x.E)&&ELO_G>0){ const g=1+ELO_G*Math.abs(2*x.E-1); lA*=g; lB*=g; }
  return [lA,lB];
}
// Promedio de los últimos 10 partidos (de local o de visitante) de un equipo: [partidos, rematesAlArcoHace, rematesAlArcoRecibe, córnersHace, córnersRecibe, tarjetas] o null si hay menos de 5.
export function venueAvg(list){
  const L=(list||[]).filter(g=>g.sf!=null&&g.sa!=null&&g.cf!=null&&g.ca!=null&&g.cd!=null).slice(-10); if(L.length<5) return null;
  const av=k=>L.reduce((s,g)=>s+g[k],0)/L.length; return [L.length,av('sf'),av('sa'),av('cf'),av('ca'),av('cd')];
}
// Remates al arco esperados [local, visita] a partir de los últimos 10 de local del local y de visitante del visitante.
// Esperados de remates al arco, córners y tarjetas de un partido (misma cuenta que venueX() en index.html):
// actual = promedio de los últimos 10 de local del local y de visitante del visitante; se promedia con los últimos 5 cruces directos (si hay al menos 3 con dato)
// y el esperado es 60 % de ese promedio + 40 % del actual. pair: filas del cruce, el más nuevo primero, orientadas al local de hoy:
// [rematesLocal, rematesVisita, córnersLocal, córnersVisita, tarjetasLocal, tarjetasVisita].
export const W_MIX=0.6;
function mixCur(cur,pair,i){ if(!cur) return null; const hr=(pair||[]).filter(x=>x[i]!=null&&x[i+1]!=null).slice(0,5); if(hr.length<3) return cur;
  const q0=hr.reduce((s,x)=>s+x[i],0)/hr.length, q1=hr.reduce((s,x)=>s+x[i+1],0)/hr.length, mx=(c,z)=>W_MIX*((c+z)/2)+(1-W_MIX)*c; return [mx(cur[0],q0),mx(cur[1],q1)]; }
export function statExpects(vhList,vaList,pair){ const A=venueAvg(vhList), B=venueAvg(vaList); if(!A||!B) return null;
  return { sot:mixCur([(A[1]+B[2])/2,(B[1]+A[2])/2],pair,0), cor:mixCur([(A[3]+B[4])/2,(B[3]+A[4])/2],pair,2), car:mixCur([A[5],B[5]],pair,4) }; }
export function sot10(Hh,Aa){ if(!Hh||!Aa) return null; return [(Hh[1]+Aa[2])/2,(Aa[1]+Hh[2])/2]; }
export const eloE=(eh,ea)=>1/(1+Math.pow(10,-(eh+60-ea)/400));
// Promedios de la temporada de un equipo del historial: [golesAFavorPorPartido, golesEnContraPorPartido] o null.
const seasonOf=T=>T&&T.n>=3?[T.gf/T.n,T.ga/T.n]:null;

const STOP = new Set(['fc','cf','afc','ac','as','ssc','sc','rc','ud','cd','us','sv','vfb','vfl','tsg','fsv','bv','sd','ca','club','de','la','the','1','sk','ogc','losc','rcd','real','deportivo','olympique','stade','borussia','hotspur','hove','albion','wanderers','city','united','town']);
export const plain = t => String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
const toks = t => plain(t).split(' ').filter(w=>w&&!STOP.has(w));

// Nombres que no se parecen lo suficiente (clave: nombre de la API ya normalizado; valor: nombre del CSV normalizado)
const ALIAS = {
  'manchester city':'man city','man city':'man city','manchester united':'man united','man united':'man united',
  'nottingham forest':'nott m forest','nottingham':'nott m forest','nott m forest':'nott m forest',
  'wolverhampton wanderers':'wolves','wolverhampton':'wolves','tottenham hotspur':'tottenham','spurs':'tottenham',
  'leeds united':'leeds','brighton hove albion':'brighton','brighton hove':'brighton','west ham united':'west ham','newcastle united':'newcastle',
  'atletico madrid':'ath madrid','club atletico de madrid':'ath madrid','atletico de madrid':'ath madrid','athletic bilbao':'ath bilbao','athletic club':'ath bilbao',
  'real betis':'betis','real sociedad':'sociedad','rayo vallecano':'vallecano','espanyol':'espanol','rcd espanyol de barcelona':'espanol','celta vigo':'celta','rc celta':'celta','alaves':'alaves','deportivo alaves':'alaves',
  'bayern munchen':'bayern munich','bayern munich':'bayern munich','bayern munich':'bayern munich','fc bayern munchen':'bayern munich',
  'borussia monchengladbach':'m gladbach','monchengladbach':'m gladbach','gladbach':'m gladbach','eintracht frankfurt':'ein frankfurt','frankfurt':'ein frankfurt',
  'koln':'fc koln','1 fc koln':'fc koln','fc koln':'fc koln','hamburger sv':'hamburg','hamburg':'hamburg','mainz 05':'mainz','1 fsv mainz 05':'mainz',
  'fc st pauli':'st pauli','st pauli':'st pauli','union berlin':'union berlin','1 fc union berlin':'union berlin','1 fc heidenheim 1846':'heidenheim','heidenheim':'heidenheim',
  'paris saint germain':'paris sg','psg':'paris sg','paris sg':'paris sg','olympique marseille':'marseille','olympique de marseille':'marseille','olympique lyonnais':'lyon',
  'saint etienne':'st etienne','as saint etienne':'st etienne','stade rennais':'rennes','stade brestois 29':'brest',
  'sporting cp':'sp lisbon','sporting clube de portugal':'sp lisbon','sporting':'sp lisbon','sporting lisbon':'sp lisbon','sc braga':'sp braga','braga':'sp braga','sporting braga':'sp braga',
  'vitoria sc':'guimaraes','vitoria guimaraes':'guimaraes','vitoria de guimaraes':'guimaraes','fc porto':'porto','sl benfica':'benfica','fc famalicao':'famalicao','estrela da amadora':'estrela','cf estrela da amadora':'estrela',
  'gd estoril praia':'estoril','estoril praia':'estoril','avs futebol sad':'avs','casa pia ac':'casa pia',
  'afc ajax':'ajax','psv':'psv eindhoven','az':'az alkmaar','fc twente':'twente','fc utrecht':'utrecht','sc heerenveen':'heerenveen','fc groningen':'groningen','nec':'nijmegen','nec nijmegen':'nijmegen',
  'fortuna sittard':'for sittard','heracles almelo':'heracles','pec zwolle':'zwolle','rkc waalwijk':'waalwijk','fc volendam':'volendam','excelsior rotterdam':'excelsior','sbv excelsior':'excelsior','almere city fc':'almere city',
  'flamengo':'flamengo rj','botafogo':'botafogo rj','vasco da gama':'vasco','atletico mineiro':'atletico mg','clube atletico mineiro':'atletico mg','athletico paranaense':'athletico pr','club athletico paranaense':'athletico pr',
  'red bull bragantino':'bragantino','rb bragantino':'bragantino','sao paulo':'sao paulo','ec vitoria':'vitoria','ec bahia':'bahia','coritiba fc':'coritiba',
  'barca':'barcelona','fc barcelona':'barcelona','atleti':'ath madrid','deportivo':'la coruna','deportivo la coruna':'la coruna','rc deportivo':'la coruna','hsv':'hamburg','amadora':'estrela','paranaense':'athletico pr','mineiro':'atletico mg',
  'ac milan':'milan','fc internazionale milano':'inter','inter milan':'inter','internazionale':'inter','hellas verona':'verona',
};

// Palabras que no ayudan a reconocer un club ("FC", "Calcio", años...). Se quitan antes de comparar.
const NOISE = new Set(['fc','cf','afc','sc','osc','sco','bc','cfc','calcio','balompie','futbol','de','ssc','ss','us','acf','cd','ud','rcd','rc','ogc','losc','aj','as','ca','sv','vfb','vfl','tsg','fsv','bv','sd','sk','club','the','la']);
export const clean = t => plain(t).split(' ').filter(w=>w&&!NOISE.has(w)&&!/^\d+$/.test(w)).join(' ');
const ALIAS_C = Object.fromEntries(Object.entries(ALIAS).map(([k,v])=>[clean(k),clean(v)]));
ALIAS_C[clean('rayo vallecano de madrid')]=clean('vallecano');

// ¿A qué equipo del CSV corresponde este nombre de la API? (null si no hay una coincidencia clara)
export function matchName(apiName, csvNames){
  const key=clean(apiName), byC=new Map(csvNames.map(n=>[clean(n),n]));
  if(ALIAS_C[key] && byC.has(ALIAS_C[key])) return byC.get(ALIAS_C[key]);
  if(byC.has(key)) return byC.get(key);
  const want=toks(apiName); if(!want.length) return null;
  let best=[], bs=0;
  for(const n of csvNames){
    const have=toks(n); if(!have.length) continue;
    const common=have.filter(w=>want.includes(w)).length;
    if(common<Math.min(have.length,want.length)) continue;           // el nombre más corto tiene que estar completo dentro del otro
    const sc=common/Math.max(have.length,want.length);
    if(sc>bs){ bs=sc; best=[n]; } else if(sc===bs) best.push(n);
  }
  return best.length===1 ? best[0] : null;
}

// Remates al arco esperados de cada equipo en un partido: lo que genera el ataque propio cruzado con lo que concede la defensa rival (temporada en curso). null si faltan datos.
export function sotExpOf(st,h,a){ const H=st.t[h], A=st.t[a]; if(!H||!A||H.ns<5||A.ns<5) return null;
  const r=x=>Math.round(x*100)/100; return [r((H.sf/H.ns+A.sa/A.ns)/2), r((A.sf/A.ns+H.sa/H.ns)/2)]; }

// Ratings al día de hoy: Elo acumulado de todas las temporadas y estadísticas de la temporada en curso.
export function buildModel(hist){
  const byL={};
  for(const r of hist.partidos){ const [lg,se,date,h,a,hg,ag,o1,o2,o3,u1,u2,hs,as_,hst,ast,hc,ac,hy,ay,hr,ar]=r;
    ((byL[lg]=byL[lg]||{})[se]=byL[lg][se]||[]).push({h,a,date,hg,ag,hs,as:as_,hst,ast,hc:hc??null,ac:ac??null,hy:hy??null,ay:ay??null,hr:hr??null,ar:ar??null}); }
  // Últimos partidos de local y de visitante de cada equipo (todas las temporadas, en orden), con remates al arco, córners y tarjetas.
  const vg=(m,home)=>home?{sf:m.hst,sa:m.ast,cf:m.hc,ca:m.ac,cd:m.hy==null?null:m.hy+(m.hr||0)}:{sf:m.ast,sa:m.hst,cf:m.ac,ca:m.hc,cd:m.ay==null?null:m.ay+(m.ar||0)};
  const ven={};
  for(const [lg,seasons] of Object.entries(byL)){ const V=ven[lg]={h:{},a:{}};
    for(const se of Object.keys(seasons).sort()) for(const m of [...seasons[se]].sort((x,y)=>x.date<y.date?-1:1)){ (V.h[m.h]=V.h[m.h]||[]).push(vg(m,true)); (V.a[m.a]=V.a[m.a]||[]).push(vg(m,false)); } }
  // Cuántos remates al arco hacen falta, en promedio, para un gol: todas las ligas y temporadas del historial.
  let cg=0, cs=0, cn=0;
  for(const r of hist.partidos){ const hst=r[14], ast=r[15]; if(hst==null||ast==null) continue; cg+=r[5]+r[6]; cs+=hst+ast; cn++; }
  const conv = cs>0 ? cg/cs : 0.31;                       // goles por remate al arco
  const leagues={};
  let hdate=''; for(const r of hist.partidos) if(r[2]>hdate) hdate=r[2];
  hdate=hdate.slice(0,10);
  const conCorners=hist.partidos.filter(r=>r[16]!=null&&r[18]!=null).length;
  for(const [lg,seasons] of Object.entries(byL)){
    const elo={}; let st=null, last=null;
    for(const se of Object.keys(seasons).sort()){
      for(const t of Object.keys(elo)) elo[t]=1500+0.75*(elo[t]-1500);        // igual que en el backtest
      st=newState(elo); last=se;
      for(const m of [...seasons[se]].sort((x,y)=>x.date<y.date?-1:1)) learn(st,m);
    }
    if(st) leagues[lg]={ st, season:last, names:Object.keys(st.t), cache:{} };
  }
  const resolve=(L,name)=>{ if(!(name in L.cache)) L.cache[name]=matchName(name,L.names); return L.cache[name]; };
  return {
    info:{ partidos:hist.partidos.length, conCorners, hasta:hdate },
    leagues, resolve: (lg,name)=>leagues[lg]?resolve(leagues[lg],name):null,
    // probabilidades en % [local, empate, visita] con un decimal, o null si no se puede
    predict(lg,h,a){ const L=leagues[lg]; if(!L) return null; const ch=resolve(L,h), ca=resolve(L,a); if(!ch||!ca||ch===ca) return null;
      const { p }=modelD(L.st,ch,ca); if(!p.every(Number.isFinite)) return null;
      const r=p.map(x=>Math.round(1000*x)/10); r[1]=Math.round((100-r[0]-r[2])*10)/10; return r; },
    // Números de cada equipo para que el navegador repita el mismo cálculo (comparador y goles esperados).
    // { liga: { l:[partidos, golesLocal, golesVisita, golesTotales, xGTotal], t:{ equipo:[PJ, GF, GC, xGF, xGC, Elo] } } }
    snapshot(data){ const out={}, r2=x=>Math.round(x*100)/100;
      for(const lg of data){ const L=leagues[lg.id]; if(!L||lg.id==='ucl') continue;
        const names=Object.values(lg.groups).flat().map(r=>r[0]), t={};
        for(const n of names){ const c=resolve(L,n); const T=c&&L.st.t[c]; if(!T) continue; const sq=l=>l&&l.length?l.slice(-5).map(x=>x===1?'G':x===.5?'E':'P').join(''):'', F=L.st.fm&&L.st.fm[c], wh=winPct(F&&F.h), wa=winPct(F&&F.a);
          t[n]=[T.n,T.gf,T.ga,r2(T.xf),r2(T.xa),r2(eloNow(L.st,c)),T.ns||0,r2(T.sf||0),r2(T.sa||0),wh==null?null:Math.round(wh*100),wa==null?null:Math.round(wa*100),sq(F&&F.h),sq(F&&F.a)];
          { const VV=ven[lg.id], r1=x=>x==null?null:Math.round(x*10)/10, vh=VV&&venueAvg(VV.h[c]), va=VV&&venueAvg(VV.a[c]); t[n][13]=vh?[vh[0],...vh.slice(1).map(r1)]:null; t[n][14]=va?[va[0],...va.slice(1).map(r1)]:null; }   /* [13]=últimos 10 de local, [14]=últimos 10 de visitante: [partidos, remates al arco a favor, en contra, córners a favor, en contra, tarjetas] */ /* [9]=% victorias de local (últimos 5), [10]=% de visitante (últimos 5), [11]/[12]=secuencia G/E/P de local y de visitante (más viejo primero) */ }
        if(Object.keys(t).length<2) continue;
        const g=L.st.xg||{goals:0,den:0}; out[lg.id]={ l:[L.st.n,L.st.hg,L.st.ag,g.goals,r2(g.den),L.st.ns||0,L.st.hsot||0,L.st.asot||0], t }; }
      out._fk=FORM_K; out._wr=W_RECENT; out._ws=W_SHOTS; out._eg=ELO_G; out._hd=hdate; out._eu=[Math.round(conv*10000)/10000, cn];      // [goles por remate al arco, partidos con datos de remates]
      return out; },
    // Partidos de las últimas `days` semanas, predichos SIN ver su resultado (el modelo solo sabe lo que pasó antes de cada uno).
    // Cada fila: [liga, fecha, local, visita, %local, %empate, %visita, golesLocal, golesVisita]
    retro(days=21,all=false){
      let max=''; for(const r of hist.partidos) if(r[2]>max) max=r[2];
      const cut=new Date(Date.parse(max.slice(0,10))-days*864e5).toISOString().slice(0,10), out=[];   // fila: [liga, fecha, local, visita, %1, %X, %2, golesL, golesV, %más2,5, %ambosMarcan, golesEsperadosL, golesEsperadosV]
      for(const [lg,seasons] of Object.entries(byL)){
        const elo={}, rec={}, vh={}, va={}, pairs={}; let st=null; const keys=Object.keys(seasons).sort();
        const cdOf=(y,r)=>y==null?null:y+(r||0), pkey=(x,y)=>x<y?x+'|'+y:y+'|'+x;
        const pairOf=(h,a)=>(pairs[pkey(h,a)]||[]).slice().reverse().map(g=>g.h===h?[g.hst,g.ast,g.hc,g.ac,cdOf(g.hy,g.hr),cdOf(g.ay,g.ar)]:[g.ast,g.hst,g.ac,g.hc,cdOf(g.ay,g.ar),cdOf(g.hy,g.hr)]);
        for(const se of keys){
          for(const t of Object.keys(elo)) elo[t]=1500+0.75*(elo[t]-1500);
          st=newState(elo); const cnt={};   // partidos jugados por equipo en la temporada: la fecha (jornada) de cada partido
          for(const m of [...seasons[se]].sort((x,y)=>x.date<y.date?-1:1)){
            if((all||se===keys[keys.length-1]) && m.date.slice(0,10)>=cut){
              const H=st.t[m.h], A=st.t[m.a];
              if(H&&A&&H.n>=MIN_GAMES&&A.n>=MIN_GAMES){
                const { p }=modelD(st,m.h,m.a);
                if(p.every(Number.isFinite)){ const r=p.map(x=>Math.round(1000*x)/10); r[1]=Math.round((100-r[0]-r[2])*10)/10;
                  const xx={ sot:sot10(venueAvg(vh[m.h]),venueAvg(va[m.a])), E:eloE(eloNow(st,m.h),eloNow(st,m.a)) };
                  const ge=goalsExp((rec[m.h]||[]).slice(-5),(rec[m.a]||[]).slice(-5),seasonOf(H),seasonOf(A),xx,conv)||[null,null,null,null];
                  out.push([lg,m.date.slice(0,10),m.h,m.a,r[0],r[1],r[2],m.hg,m.ag,...ge,m.hst??null,m.ast??null,...(sotExpOf(st,m.h,m.a)||[null,null]),Math.max(cnt[m.h]||0,cnt[m.a]||0)+1,
                    ...(()=>{ const q=statExpects(vh[m.h],va[m.a],pairOf(m.h,m.a)), r2=v=>v==null?null:Math.round(v*100)/100; /* [18..21] córners y tarjetas esperados (local, visita); [22..25] córners y tarjetas reales */
                      return [q?r2(q.cor[0]):null,q?r2(q.cor[1]):null,q?r2(q.car[0]):null,q?r2(q.car[1]):null,m.hc??null,m.ac??null,cdOf(m.hy,m.hr),cdOf(m.ay,m.ar)]; })()]); }
              }
            }
            learn(st,m); cnt[m.h]=(cnt[m.h]||0)+1; cnt[m.a]=(cnt[m.a]||0)+1;
            (rec[m.h]=rec[m.h]||[]).push([m.hg,m.ag]); (rec[m.a]=rec[m.a]||[]).push([m.ag,m.hg]);
            (vh[m.h]=vh[m.h]||[]).push(vg(m,true)); (va[m.a]=va[m.a]||[]).push(vg(m,false));
            (pairs[pkey(m.h,m.a)]=pairs[pkey(m.h,m.a)]||[]).push(m);
          }
        }
      }
      return out.sort((x,y)=>x[1]<y[1]?1:x[1]>y[1]?-1:0);
    },
    // Últimos `n` partidos de liga entre los dos equipos (de las temporadas del historial): [fecha, 1 si el local de hoy jugó de local, golesLocalDeHoy, golesVisitaDeHoy], el más nuevo primero.
    h2h(lg,h,a,n=5){ const cd=(y,r)=>y==null?null:y+(r||0); const L=leagues[lg]; if(!L) return null; const ch=resolve(L,h), ca=resolve(L,a); if(!ch||!ca||ch===ca) return null; const out=[];
      for(const se of Object.keys(byL[lg])) for(const m of byL[lg][se]){
        if(m.h===ch&&m.a===ca) out.push([m.date.slice(0,10),1,m.hg,m.ag,m.hst??null,m.ast??null,m.hc,m.ac,cd(m.hy,m.hr),cd(m.ay,m.ar)]); else if(m.h===ca&&m.a===ch) out.push([m.date.slice(0,10),0,m.ag,m.hg,m.ast??null,m.hst??null,m.ac,m.hc,cd(m.ay,m.ar),cd(m.hy,m.hr)]); }   // [4],[5] remates al arco, [6],[7] córners y [8],[9] tarjetas (amarillas + rojas) del local de hoy y del visitante de hoy en ese partido
      return out.sort((x,y)=>x[0]<y[0]?1:x[0]>y[0]?-1:0).slice(0,n); },
    // Datos extra para el ajuste de goles de un partido futuro: { sot:[local,visita]|null, E } o null; y goles por remate al arco.
    xInfo(lg,h,a){ const L=leagues[lg], VV=ven[lg]; if(!L||!VV) return null; const ch=resolve(L,h), ca=resolve(L,a); if(!ch||!ca||ch===ca) return null;
      return { sot:sot10(venueAvg(VV.h[ch]),venueAvg(VV.a[ca])), E:eloE(eloNow(L.st,ch),eloNow(L.st,ca)) }; },
    conv,
    // Promedios de la temporada de un equipo de la API: [golesAFavorPorPartido, golesEnContraPorPartido] o null.
    seasonGoals(lg,name){ const L=leagues[lg]; if(!L) return null; const c=resolve(L,name); return c?seasonOf(L.st.t[c]):null; },
    // Remates al arco esperados de un partido futuro: [local, visita] o null.
    sotExp(lg,h,a){ const L=leagues[lg]; if(!L) return null; const ch=resolve(L,h), ca=resolve(L,a); if(!ch||!ca||ch===ca) return null; return sotExpOf(L.st,ch,ca); },
    // Resultado de un partido ya jugado según el historial (llega uno o dos días tarde): [golesLocal, golesVisita] o null.
    matchResult(lg,h,a,iso){ const L=leagues[lg]; if(!L||!byL[lg]) return null; const ch=resolve(L,h), ca=resolve(L,a); if(!ch||!ca) return null; const t=Date.parse(String(iso).slice(0,10));
      for(const se of Object.keys(byL[lg])) for(const m of byL[lg][se]){ if(m.h===ch&&m.a===ca&&Math.abs(Date.parse(m.date.slice(0,10))-t)<=3*864e5) return [m.hg,m.ag]; }
      return null; },
    // Remates al arco que hubo en un partido ya jugado (si el historial ya lo trae): [local, visita] o null. `iso` es la fecha del partido.
    matchSoT(lg,h,a,iso){ const L=leagues[lg]; if(!L||!byL[lg]) return null; const ch=resolve(L,h), ca=resolve(L,a); if(!ch||!ca) return null; const t=Date.parse(String(iso).slice(0,10));
      for(const se of Object.keys(byL[lg])) for(const m of byL[lg][se]){ if(m.h===ch&&m.a===ca&&Math.abs(Date.parse(m.date.slice(0,10))-t)<=3*864e5) return m.hst!=null&&m.ast!=null?[m.hst,m.ast]:null; }
      return null; },
    // para el log: equipos de la API que no se pudieron emparejar
    unmatched(lg,names){ const L=leagues[lg]; return L?names.filter(n=>!resolve(L,n)):names; },
  };
}
export function loadModel(file){
  try{ if(!fs.existsSync(file)) return null; const h=JSON.parse(fs.readFileSync(file,'utf8')); return h.partidos&&h.partidos.length?buildModel(h):null; }
  catch(e){ console.warn('[modelo] no se pudo leer history.json:',e.message); return null; }
}
