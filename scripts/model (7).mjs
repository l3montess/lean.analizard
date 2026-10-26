// Modelo D para el sitio: promedio de "goles + remates" (X) y Elo, probado en backtest.mjs contra ~6.000 partidos.
// Se alimenta de history.json (football-data.co.uk). Si algo falta, devuelve null y el sitio usa el modelo simple de siempre.
import fs from 'node:fs';
import { newState, learn, modelD } from './backtest.mjs';
const MIN_GAMES=5;
const eloNow=(st,t)=>(st.elo&&st.elo[t])??1500;
const pz=(k,l)=>{ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; };
// Goles esperados con los últimos 10 partidos de cada equipo (cualquier competición): fa y fb = listas de [golesAFavor, golesEnContra].
// Devuelve null si a alguno le faltan partidos (hacen falta 5). o25 y bt en %, lA y lB en goles.
export function goalsExp(fa,fb){
  if(!fa||!fb||fa.length<5||fb.length<5) return null;
  const av=(L,i)=>L.reduce((s,x)=>s+x[i],0)/L.length;
  const lA=(av(fa,0)+av(fb,1))/2, lB=(av(fb,0)+av(fa,1))/2, lt=lA+lB;
  const o25=1-(pz(0,lt)+pz(1,lt)+pz(2,lt)), bt=(1-Math.exp(-lA))*(1-Math.exp(-lB));
  return [Math.round(o25*1000)/10, Math.round(bt*1000)/10, Math.round(lA*100)/100, Math.round(lB*100)/100];
}

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
  for(const r of hist.partidos){ const [lg,se,date,h,a,hg,ag,o1,o2,o3,u1,u2,hs,as_,hst,ast]=r;
    ((byL[lg]=byL[lg]||{})[se]=byL[lg][se]||[]).push({h,a,date,hg,ag,hs,as:as_,hst,ast}); }
  // Cuántos remates al arco hacen falta, en promedio, para un gol: todas las ligas y temporadas del historial.
  let cg=0, cs=0, cn=0;
  for(const r of hist.partidos){ const hst=r[14], ast=r[15]; if(hst==null||ast==null) continue; cg+=r[5]+r[6]; cs+=hst+ast; cn++; }
  const conv = cs>0 ? cg/cs : 0.31;                       // goles por remate al arco
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
        for(const n of names){ const c=resolve(L,n); const T=c&&L.st.t[c]; if(!T) continue; t[n]=[T.n,T.gf,T.ga,r2(T.xf),r2(T.xa),r2(eloNow(L.st,c)),T.ns||0,r2(T.sf||0),r2(T.sa||0)]; }
        if(Object.keys(t).length<2) continue;
        const g=L.st.xg||{goals:0,den:0}; out[lg.id]={ l:[L.st.n,L.st.hg,L.st.ag,g.goals,r2(g.den),L.st.ns||0,L.st.hsot||0,L.st.asot||0], t }; }
      out._eu=[Math.round(conv*10000)/10000, cn];      // [goles por remate al arco, partidos con datos de remates]
      return out; },
    // Partidos de las últimas `days` semanas, predichos SIN ver su resultado (el modelo solo sabe lo que pasó antes de cada uno).
    // Cada fila: [liga, fecha, local, visita, %local, %empate, %visita, golesLocal, golesVisita]
    retro(days=21){
      let max=''; for(const r of hist.partidos) if(r[2]>max) max=r[2];
      const cut=new Date(Date.parse(max.slice(0,10))-days*864e5).toISOString().slice(0,10), out=[];   // fila: [liga, fecha, local, visita, %1, %X, %2, golesL, golesV, %más2,5, %ambosMarcan, golesEsperadosL, golesEsperadosV]
      for(const [lg,seasons] of Object.entries(byL)){
        const elo={}, rec={}; let st=null; const keys=Object.keys(seasons).sort();
        for(const se of keys){
          for(const t of Object.keys(elo)) elo[t]=1500+0.75*(elo[t]-1500);
          st=newState(elo); const cnt={};   // partidos jugados por equipo en la temporada: la fecha (jornada) de cada partido
          for(const m of [...seasons[se]].sort((x,y)=>x.date<y.date?-1:1)){
            if(se===keys[keys.length-1] && m.date.slice(0,10)>=cut){
              const H=st.t[m.h], A=st.t[m.a];
              if(H&&A&&H.n>=MIN_GAMES&&A.n>=MIN_GAMES){
                const { p }=modelD(st,m.h,m.a);
                if(p.every(Number.isFinite)){ const r=p.map(x=>Math.round(1000*x)/10); r[1]=Math.round((100-r[0]-r[2])*10)/10;
                  const ge=goalsExp((rec[m.h]||[]).slice(-10),(rec[m.a]||[]).slice(-10))||[null,null,null,null];
                  out.push([lg,m.date.slice(0,10),m.h,m.a,r[0],r[1],r[2],m.hg,m.ag,...ge,m.hst??null,m.ast??null,...(sotExpOf(st,m.h,m.a)||[null,null]),Math.max(cnt[m.h]||0,cnt[m.a]||0)+1]); }
              }
            }
            learn(st,m); cnt[m.h]=(cnt[m.h]||0)+1; cnt[m.a]=(cnt[m.a]||0)+1;
            (rec[m.h]=rec[m.h]||[]).push([m.hg,m.ag]); (rec[m.a]=rec[m.a]||[]).push([m.ag,m.hg]);
          }
        }
      }
      return out.sort((x,y)=>x[1]<y[1]?1:x[1]>y[1]?-1:0);
    },
    // Últimos `n` partidos de liga entre los dos equipos (de las temporadas del historial): [fecha, 1 si el local de hoy jugó de local, golesLocalDeHoy, golesVisitaDeHoy], el más nuevo primero.
    h2h(lg,h,a,n=5){ const L=leagues[lg]; if(!L) return null; const ch=resolve(L,h), ca=resolve(L,a); if(!ch||!ca||ch===ca) return null; const out=[];
      for(const se of Object.keys(byL[lg])) for(const m of byL[lg][se]){
        if(m.h===ch&&m.a===ca) out.push([m.date.slice(0,10),1,m.hg,m.ag]); else if(m.h===ca&&m.a===ch) out.push([m.date.slice(0,10),0,m.ag,m.hg]); }
      return out.sort((x,y)=>x[0]<y[0]?1:x[0]>y[0]?-1:0).slice(0,n); },
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
