// Modelo D para el sitio: promedio de "goles + remates" (X) y Elo, probado en backtest.mjs contra ~6.000 partidos.
// Se alimenta de history.json (football-data.co.uk). Si algo falta, devuelve null y el sitio usa el modelo simple de siempre.
import fs from 'node:fs';
import { newState, learn, modelD } from './backtest.mjs';
const eloNow=(st,t)=>(st.elo&&st.elo[t])??1500;

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

// Ratings al día de hoy: Elo acumulado de todas las temporadas y estadísticas de la temporada en curso.
export function buildModel(hist){
  const byL={};
  for(const r of hist.partidos){ const [lg,se,date,h,a,hg,ag,o1,o2,o3,u1,u2,hs,as_,hst,ast]=r;
    ((byL[lg]=byL[lg]||{})[se]=byL[lg][se]||[]).push({h,a,date,hg,ag,hs,as:as_,hst,ast}); }
  const leagues={};
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
        for(const n of names){ const c=resolve(L,n); const T=c&&L.st.t[c]; if(!T) continue; t[n]=[T.n,T.gf,T.ga,r2(T.xf),r2(T.xa),r2(eloNow(L.st,c))]; }
        if(Object.keys(t).length<2) continue;
        const g=L.st.xg||{goals:0,den:0}; out[lg.id]={ l:[L.st.n,L.st.hg,L.st.ag,g.goals,r2(g.den)], t }; }
      return out; },
    // para el log: equipos de la API que no se pudieron emparejar
    unmatched(lg,names){ const L=leagues[lg]; return L?names.filter(n=>!resolve(L,n)):names; },
  };
}
export function loadModel(file){
  try{ if(!fs.existsSync(file)) return null; const h=JSON.parse(fs.readFileSync(file,'utf8')); return h.partidos&&h.partidos.length?buildModel(h):null; }
  catch(e){ console.warn('[modelo] no se pudo leer history.json:',e.message); return null; }
}
