// Actualiza data.js con tablas, goleadores, forma y próximos partidos de 5 ligas
// usando la API gratuita de football-data.org. Argentina no está en esa API: se conserva tal cual.
// Uso: FOOTBALL_DATA_KEY=tu_clave node scripts/update.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadModel, goalsExp } from './model.mjs';

const COMPS = { epl:'PL', esp:'PD', ita:'SA', ger:'BL1', fra:'FL1', ned:'DED', ppl:'PPL', bra:'BSA', ucl:'CL' }; // Europa League no está en el plan gratuito
const fmtDate = d => d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Argentina/Buenos_Aires'});

// Historial de predicciones: cada partido se guarda ANTES de empezar y no se toca después; al terminar se le agrega el resultado.
// Fila: [liga, fecha de inicio, local, visita, %local, %empate, %visita, golesLocal|null, golesVisita|null, %más2,5, %ambosMarcan, golesEsperadosL, golesEsperadosV,
//        remates al arco reales L|null, V|null (se completan cuando el historial los trae), remates al arco esperados L|null, V|null (se congelan antes del partido)]
export function trackPredictions(log, data, finished, now=Date.now(), recent={}, model=null){
  const pairs=t=>(recent[t]||[]).slice(0,10).map(x=>[x[4],x[5]]);       // últimos 10 partidos de cada equipo: [a favor, en contra]
  const extras=(h,a)=>goalsExp(pairs(h),pairs(a))||[null,null,null,null];
  const sotE=(lg,h,a)=>(model&&model.sotExp&&model.sotExp(lg,h,a))||[null,null];
  for(const r of log) while(r.length<18) r.push(null);              // filas viejas: se completan con vacíos
  for(const L of data) for(const f of (L.fixtures||[])){
    const [iso,h,a,ph,px,pa,md]=f, ko=Date.parse(iso); if(!Number.isFinite(ko)) continue;
    const row=log.find(r=>r[0]===L.id&&r[2]===h&&r[3]===a&&Math.abs(Date.parse(r[1])-ko)<3*864e5);
    if(!row){ if(ko>now) log.push([L.id,iso,h,a,ph,px,pa,null,null,...extras(h,a),null,null,...sotE(L.id,h,a),md??null]); }
    else if(row[7]==null && ko>now){ row[1]=iso; row[4]=ph; row[5]=px; row[6]=pa; row.splice(9,4,...extras(h,a)); [row[15],row[16]]=sotE(L.id,h,a); if(md!=null) row[17]=md; }        // se actualiza hasta que empieza
  }
  for(const r of log){ if(r[7]!=null) continue;
    const m=finished.find(x=>x.h===r[2]&&x.a===r[3]&&Math.abs(Date.parse(x.iso)-Date.parse(r[1]))<3*864e5);
    if(m){ r[7]=m.gh; r[8]=m.ga; } }
  if(model&&model.matchResult) for(const r of log){ if(r[7]!=null||now-Date.parse(r[1])<3*36e5) continue;      // la API gratuita informa los resultados con retraso: si el historial ya lo trae, se usa
    const g=model.matchResult(r[0],r[2],r[3],r[1]); if(g){ r[7]=g[0]; r[8]=g[1]; } }
  if(model&&model.matchSoT) for(const r of log){ if(r[7]==null||r[13]!=null||now-Date.parse(r[1])>21*864e5) continue;      // los remates reales llegan al historial uno o dos días después
    const sh=model.matchSoT(r[0],r[2],r[3],r[1]); if(sh){ r[13]=sh[0]; r[14]=sh[1]; } }
  log.sort((x,y)=>x[1]<y[1]?1:x[1]>y[1]?-1:0);
  if(log.length>1500) log.length=1500;
  return log;
}

// Probabilidades 1X2 con un modelo de Poisson simple (ventaja de local 10 %). No es un modelo profesional.
function poisson(k,l){ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; }
function probs(h,a){
  const lh=1.1*((h[5]/h[1])+(a[6]/a[1]))/2, la=((a[5]/a[1])+(h[6]/h[1]))/2/1.0;
  let ph=0,px=0,pa=0;
  for(let i=0;i<=8;i++) for(let j=0;j<=8;j++){ const p=poisson(i,lh)*poisson(j,la); if(i>j) ph+=p; else if(i===j) px+=p; else pa+=p; }
  const t=ph+px+pa; return [ph,px,pa].map(x=>Math.round(1000*x/t)/10);
}

const LABEL = { PL:'Premier', PD:'LaLiga', SA:'Serie A', BL1:'Bundesliga', FL1:'Ligue 1', DED:'Eredivisie', PPL:'Liga Portugal', BSA:'Brasileirão', CL:'Champions' };

// Últimos 5 partidos de cada equipo en CUALQUIERA de las competiciones del plan gratis (liga + Champions).
// Cada fila: [fecha ISO, competición, 'L' local / 'V' visitante, rival, goles a favor, goles en contra]
export function lastFive(done, names, n=10){      // últimos n partidos de cada equipo, en cualquier competición de las que bajamos
  const by = {};
  for(const m of done){
    const push=(t,side,rival,gf,ga)=>{ if(names.has(t)) (by[t]=by[t]||[]).push([m.iso,m.comp,side,rival,gf,ga]); };
    push(m.h,'L',m.a,m.gh,m.ga); push(m.a,'V',m.h,m.ga,m.gh);
  }
  for(const t of Object.keys(by)) by[t]=by[t].sort((x,y)=>y[0].localeCompare(x[0])).slice(0,n);
  return by;
}

// Ligas nuevas: si no están en data.js se crean vacías y build() las llena con la API (van antes de las copas).
export const NEW_LEAGUES = [
  { id:'ned', name:'Eredivisie', pill:'Países Bajos', desc:'Temporada en curso.', groups:{ Liga:[] }, scorers:[], fixtures:[], src:[['football-data.org','https://www.football-data.org']] },
  { id:'ppl', name:'Liga Portugal', pill:'Portugal', desc:'Temporada en curso.', groups:{ Liga:[] }, scorers:[], fixtures:[], src:[['football-data.org','https://www.football-data.org']] },
  { id:'bra', name:'Brasileirão', pill:'Brasil', desc:'Temporada en curso.', groups:{ Liga:[] }, scorers:[], fixtures:[], src:[['football-data.org','https://www.football-data.org']] },
];
export function withNewLeagues(previous){
  const have=new Set(previous.map(l=>l.id)), add=NEW_LEAGUES.filter(l=>!have.has(l.id)); if(!add.length) return previous;
  const i=previous.findIndex(l=>l.cup); return i<0?[...previous,...add]:[...previous.slice(0,i),...add,...previous.slice(i)];
}

export async function build(api, previous, crests={}, recent={}, model=null, predLog=[]){
  const out = [];
  const done = new Map(), allNames = new Set();
  for(const prev of previous){
    try{
    const code = COMPS[prev.id];
    if(!code) continue;                                   // Argentina y Europa League: quitadas por ahora
    const st = (await api(`/competitions/${code}/standings`)).standings.find(s=>s.type==='TOTAL');
    const rows = st.table.map(r=>[r.team.shortName||r.team.name, r.playedGames, r.won, r.draw, r.lost, r.goalsFor, r.goalsAgainst, r.points,
      (r.form||'').split(',').filter(Boolean).slice(-5).join('')]);
    st.table.forEach(r=>{ if(r.team.crest) crests[r.team.shortName||r.team.name]=r.team.crest; });
    const names = new Set(rows.map(r=>r[0])); names.forEach(n=>allNames.add(n));
    try{
      const fin = (await api(`/competitions/${code}/matches?status=FINISHED`)).matches || [];
      for(const m of fin){
        const gh=m.score?.fullTime?.home, ga=m.score?.fullTime?.away; if(gh==null||ga==null) continue;
        done.set(m.id,{ iso:m.utcDate.replace(/\.\d+Z$/,'Z'), comp:LABEL[code]||code, h:m.homeTeam.shortName||m.homeTeam.name, a:m.awayTeam.shortName||m.awayTeam.name, gh, ga });
      }
    }catch(e){ console.warn(prev.id,'no se pudieron bajar los partidos jugados:',e.message); }
    const sc = (await api(`/competitions/${code}/scorers?limit=15`)).scorers.map(s=>[s.player.name, s.team.shortName||s.team.name, s.goals, s.team.name]);
    const sched = (await api(`/competitions/${code}/matches?status=SCHEDULED`)).matches;
    const md = Math.min(...sched.map(m=>m.matchday));
    const byName = Object.fromEntries(rows.map(r=>[r[0],r]));
    const misses = new Set();
    const fixtures = sched.filter(m=>m.matchday===md).map(m=>{
      const h=m.homeTeam.shortName||m.homeTeam.name, a=m.awayTeam.shortName||m.awayTeam.name;
      const pm = model && prev.id!=='ucl' ? model.predict(prev.id,h,a) : null;           // modelo D; la Champions mezcla ligas y usa el modelo simple
      if(model && prev.id!=='ucl' && !pm) misses.add(h+' / '+a);
      return [m.utcDate.replace(/\.\d+Z$/,'Z').replace(/:00Z$/,':00Z'), h, a, ...(pm||probs(byName[h],byName[a])), m.matchday];
    }).filter(f=>names.has(f[1])&&names.has(f[2]));
    if(model && prev.id!=='ucl'){ const bad=model.unmatched(prev.id,[...names]); if(bad.length) console.warn(`[modelo] ${prev.id}: sin emparejar con el historial -> ${bad.join(', ')}`); if(misses.size) console.warn(`[modelo] ${prev.id}: ${misses.size} partido(s) con el modelo simple`); }
    out.push({ ...prev, groups:{ [Object.keys(prev.groups)[0]]: rows }, cal:[], scorers:sc, fixtures, asof:fmtDate(new Date()),
      probSrc: model && model.leagues[prev.id] && prev.id!=='ucl' ? 'un modelo propio (Elo + goles y remates de la temporada), probado contra unos 6.000 partidos pasados' : 'un modelo de Poisson propio basado en los goles de la temporada',
      scNote:'Actualizado automáticamente.',
      src:[['football-data.org','https://www.football-data.org']] });
    if(!rows.every(r=>r[1]>0)) console.warn(prev.id,'hay equipos sin partidos jugados');
    }catch(e){      // si una liga falla (por ejemplo, no está en el plan gratis) no se cae todo: se conserva lo que había y se sigue con las demás
      console.warn(`[${prev.id}] no se pudo actualizar: ${e.message}`);
      if(Object.values(prev.groups||{}).flat().length) out.push(prev);
    }
  }
  Object.keys(recent).forEach(k=>delete recent[k]);
  Object.assign(recent, lastFive([...done.values()], allNames));
  trackPredictions(predLog, out, [...done.values()], Date.now(), recent, model);
  return out;
}


// ---- Fotos de jugadores (API-Football, plan gratis: 100 pedidos por día; sin acceso a la temporada actual) ----
// Se busca el EQUIPO (una vez, y se guarda su id) y se baja su plantel actual: así cada foto se elige por equipo + nombre.
// Cada corrida hace como máximo MAX_FOTOS pedidos; lo que ya tiene foto no se vuelve a pedir.
const MAX_FOTOS = 60;
const COUNTRY = { epl:'England', esp:'Spain', ita:'Italy', ger:'Germany', fra:'France', ned:'Netherlands', ppl:'Portugal', bra:'Brazil' };
const STOP = new Set(['fc','cf','afc','sc','ac','as','ssc','rc','ud','cd','us','sv','vfb','vfl','tsg','fsv','bv','rb','sd','ca','cfc','club','de','la','the','real']);
const plain = t => String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\s+/g,' ').trim();
const toks = t => plain(t).split(' ').filter(Boolean);
const day = () => new Date().toISOString().slice(0,10);
const stale = d => (Date.parse(day())-Date.parse(d))/864e5 > 14;
const errOf = r => (r.errors && (Array.isArray(r.errors) ? r.errors.length : Object.keys(r.errors).length)) ? JSON.stringify(r.errors) : '';

// Elige, entre los equipos que devuelve la búsqueda, el que más se parece al nombre de football-data (y del país de la liga).
export function pickTeam(fullName, list, country){
  const want = toks(fullName).filter(w=>!STOP.has(w));
  let best=null, bs=0;
  for(const it of list||[]){
    const t = it.team||{}; if(!t.id || t.national) continue;
    if(country && it.team.country && plain(it.team.country)!==plain(country)) continue;
    const have = toks(t.name).filter(w=>!STOP.has(w)); if(!have.length||!want.length) continue;
    const common = have.filter(w=>want.includes(w)).length;
    const score = common/Math.max(have.length,want.length);
    if(score>bs){ bs=score; best=t; }
  }
  return bs>=0.5 ? best.id : null;
}
// Dentro de un plantel, elige al jugador: "E. Haaland" (inicial + apellido) o nombre completo contra "Erling Haaland".
export function matchSquad(name, players){
  const want = toks(name); const cands=[];
  for(const p of players||[]){
    if(!p.photo) continue; const have = toks(p.name); if(!have.length) continue;
    const abbr = have[0].length===1; const rest = abbr ? have.slice(1) : have; let sc=0;
    if(abbr){ if(want[0] && want[0][0]===have[0] && rest.length && rest.every(r=>want.includes(r))) sc=3; }
    else if(have.every(h=>want.includes(h))) sc=4;
    else if(want.every(w=>have.includes(w))) sc=3;
    if(sc) cands.push([sc,p.photo]);
  }
  if(!cands.length) return null;
  cands.sort((x,y)=>y[0]-x[0]);
  if(cands.length>1 && cands[1][0]===cands[0][0] && cands[1][1]!==cands[0][1]) return null;   // dos jugadores igual de parecidos: mejor no arriesgar
  return cands[0][1];
}
export async function addPhotos(data, st, fetchAf, log=console, max=MAX_FOTOS){
  const { photos, miss, teams, teamMiss } = st;
  const byTeam = new Map();                       // equipo -> {full, league, goles máx, jugadores[]}
  for(const L of data) for(const [n,t,g,full] of (L.scorers||[])){
    if(photos[n] || (miss[n] && !stale(miss[n]))) continue;
    const e = byTeam.get(t) || { full: full||t, league: L.id, g:0, players:[] };
    e.g = Math.max(e.g, g||0); if(!e.players.includes(n)) e.players.push(n); byTeam.set(t,e);
  }
  const order = [...byTeam].sort((x,y)=>y[1].g-x[1].g);
  let used=0, found=0, none=0, stopped=false;
  const call = async p => { used++; const r = await fetchAf(p); const e = errOf(r); if(e){ log.warn(`[fotos] la API devolvió un error y se detiene: ${e}`); stopped=true; } return r; };
  for(const [t,e] of order){
    if(stopped || used>=max) break;
    if(teamMiss[t] && !stale(teamMiss[t])) { e.players.forEach(n=>{ miss[n]=day(); none++; }); continue; }
    let id = teams[t];
    if(!id){
      if(used+2>max) break;
      const word = toks(e.full).filter(w=>!STOP.has(w)).reduce((a,b)=>b.length>=a.length?b:a,'');
      if(word.length<3){ teamMiss[t]=day(); continue; }
      const r = await call(`/teams?search=${encodeURIComponent(word)}`); if(stopped) break;
      id = pickTeam(e.full, r.response, COUNTRY[e.league]);
      if(!id){ teamMiss[t]=day(); log.log(`[fotos] equipo sin coincidencia: ${t}`); continue; }
      teams[t]=id; delete teamMiss[t];
    }
    const r = await call(`/players/squads?team=${id}`); if(stopped) break;
    const squad = r.response?.[0]?.players || [];
    for(const n of e.players){ const url = matchSquad(n, squad); if(url){ photos[n]=url; delete miss[n]; found++; } else { miss[n]=day(); none++; } }
  }
  const pend = order.filter(([,e])=>e.players.some(n=>!photos[n] && !(miss[n]===day()))).length;
  log.log(`[fotos] ${used} pedidos: ${found} jugadores con foto, ${none} sin coincidencia, ${pend} equipos pendientes. En total hay ${Object.keys(photos).length} fotos.`);
  return photos;
}

async function main(){
  const key = process.env.FOOTBALL_DATA_KEY;
  if(!key){ console.error('Falta FOOTBALL_DATA_KEY'); process.exit(1); }
  const file = new URL('../data.js', import.meta.url);
  const ctx = { window:{} }; vm.runInNewContext(fs.readFileSync(file,'utf8'), ctx);
  const api = async p => {                                     // el plan gratis permite 10 pedidos por minuto
    await new Promise(r=>setTimeout(r,7000));
    const res = await fetch('https://api.football-data.org/v4'+p,{headers:{'X-Auth-Token':key}});
    if(!res.ok) throw new Error(p+' -> '+res.status);
    return res.json();
  };
  const crests = ctx.window.CRESTS || {};
  const recent = {};
  const model = loadModel(fileURLToPath(new URL('../history.json', import.meta.url)));
  console.log(model ? '[modelo] usando el modelo D (history.json)' : '[modelo] sin history.json: se usa el modelo simple');
  const predLog = Array.isArray(ctx.window.PRED_LOG) ? ctx.window.PRED_LOG : [];
  const data = await build(api, withNewLeagues(ctx.window.DATA), crests, recent, model, predLog);
  // Cara a cara: últimos 5 partidos de liga entre los equipos de los próximos partidos, en forma de { 'liga|local|visita': [[fecha, local?, golesLocal, golesVisita], ...] }
  const h2h = {};
  if(model) for(const L of data) if(!L.cup) for(const f of (L.fixtures||[])){ const r=model.h2h(L.id,f[1],f[2],5); if(r&&r.length) h2h[L.id+'|'+f[1]+'|'+f[2]]=r; }
  const retro = model ? model.retro(30) : (Array.isArray(ctx.window.PRED_RETRO)?ctx.window.PRED_RETRO:[]);
  const st = { photos: ctx.window.PHOTOS || {}, miss: ctx.window.PHOTO_MISS || {}, teams: ctx.window.TEAM_IDS || {}, teamMiss: ctx.window.TEAM_MISS || {} };
  const afKey = process.env.API_FOOTBALL_KEY;
  if(afKey){
    try{
      const fetchAf = async p => { await new Promise(r=>setTimeout(r,7000)); const res = await fetch('https://v3.football.api-sports.io'+p,{headers:{'x-apisports-key':afKey}}); if(!res.ok) throw new Error(p+' -> '+res.status); return res.json(); };
      await addPhotos(data, st, fetchAf);
    }catch(e){ console.warn('[fotos] se omitieron por un error:', e.message); }
  } else console.log('[fotos] sin API_FOOTBALL_KEY: se omiten');
  fs.writeFileSync(file, '/* Generado por scripts/update.mjs (Argentina se edita a mano). */\nwindow.DATA = '+JSON.stringify(data,null,1)+';\nwindow.CRESTS = '+JSON.stringify(crests)+';\nwindow.PHOTOS = '+JSON.stringify(st.photos)+';\nwindow.PHOTO_MISS = '+JSON.stringify(st.miss)+';\nwindow.TEAM_IDS = '+JSON.stringify(st.teams)+';\nwindow.TEAM_MISS = '+JSON.stringify(st.teamMiss)+';\nwindow.RECENT = '+JSON.stringify(recent)+';\nwindow.PRED_LOG = '+JSON.stringify(predLog)+';\nwindow.PRED_RETRO = '+JSON.stringify(retro)+';\nwindow.H2H = '+JSON.stringify(h2h)+';\nwindow.MODEL = '+JSON.stringify(model?model.snapshot(data):{})+';\n');
  console.log('data.js actualizado');
}
if (process.argv[1]===fileURLToPath(import.meta.url)) main();
