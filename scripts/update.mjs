// Actualiza data.js con tablas, goleadores, forma y próximos partidos de 5 ligas
// usando la API gratuita de football-data.org. Argentina no está en esa API: se conserva tal cual.
// Uso: FOOTBALL_DATA_KEY=tu_clave node scripts/update.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const COMPS = { epl:'PL', esp:'PD', ita:'SA', ger:'BL1', fra:'FL1', ucl:'CL' }; // Europa League no está en el plan gratuito
const fmtDate = d => d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Argentina/Buenos_Aires'});

// Probabilidades 1X2 con un modelo de Poisson simple (ventaja de local 10 %). No es un modelo profesional.
function poisson(k,l){ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; }
function probs(h,a){
  const lh=1.1*((h[5]/h[1])+(a[6]/a[1]))/2, la=((a[5]/a[1])+(h[6]/h[1]))/2/1.0;
  let ph=0,px=0,pa=0;
  for(let i=0;i<=8;i++) for(let j=0;j<=8;j++){ const p=poisson(i,lh)*poisson(j,la); if(i>j) ph+=p; else if(i===j) px+=p; else pa+=p; }
  const t=ph+px+pa; return [ph,px,pa].map(x=>Math.round(1000*x/t)/10);
}

export async function build(api, previous, crests={}){
  const out = [];
  for(const prev of previous){
    const code = COMPS[prev.id];
    if(!code) continue;                                   // Argentina y Europa League: quitadas por ahora
    const st = (await api(`/competitions/${code}/standings`)).standings.find(s=>s.type==='TOTAL');
    const rows = st.table.map(r=>[r.team.shortName||r.team.name, r.playedGames, r.won, r.draw, r.lost, r.goalsFor, r.goalsAgainst, r.points,
      (r.form||'').split(',').filter(Boolean).slice(-5).join('')]);
    st.table.forEach(r=>{ if(r.team.crest) crests[r.team.shortName||r.team.name]=r.team.crest; });
    const names = new Set(rows.map(r=>r[0]));
    const sc = (await api(`/competitions/${code}/scorers?limit=15`)).scorers.map(s=>[s.player.name, s.team.shortName||s.team.name, s.goals]);
    const sched = (await api(`/competitions/${code}/matches?status=SCHEDULED`)).matches;
    const md = Math.min(...sched.map(m=>m.matchday));
    const byName = Object.fromEntries(rows.map(r=>[r[0],r]));
    const fixtures = sched.filter(m=>m.matchday===md).map(m=>{
      const h=m.homeTeam.shortName||m.homeTeam.name, a=m.awayTeam.shortName||m.awayTeam.name;
      return [m.utcDate.replace(/\.\d+Z$/,'Z').replace(/:00Z$/,':00Z'), h, a, ...probs(byName[h],byName[a])];
    }).filter(f=>names.has(f[1])&&names.has(f[2]));
    out.push({ ...prev, groups:{ [Object.keys(prev.groups)[0]]: rows }, cal:[], scorers:sc, fixtures, asof:fmtDate(new Date()),
      probSrc:'un modelo de Poisson propio basado en los goles de la temporada',
      scNote:'Actualizado automáticamente.',
      src:[['football-data.org','https://www.football-data.org']] });
    if(!rows.every(r=>r[1]>0)) console.warn(prev.id,'hay equipos sin partidos jugados');
  }
  return out;
}


// ---- Fotos de jugadores (API-Football, plan gratis: 100 pedidos por día; sin acceso a la temporada actual) ----
// Se busca el perfil de cada goleador por nombre (no depende de la temporada) y se guarda en data.js.
// Cada corrida busca como mucho MAX_FOTOS jugadores nuevos; los que ya tienen foto no se vuelven a pedir.
const MAX_FOTOS = 60;
const plain = t => String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\s+/g,' ').trim();
export function findPhoto(name, list){
  const want = plain(name).split(' ').filter(Boolean);
  const ok = [];
  for(const it of list||[]){
    const pl = it.player||{}; if(!pl.photo) continue;
    const have = new Set(plain((pl.firstname||'')+' '+(pl.lastname||'')+' '+(pl.name||'')).split(' ').filter(Boolean));
    if(want.length && want.every(w=>have.has(w))) ok.push(pl);
  }
  if(want.length===1) return ok.length===1 ? ok[0].photo : null;   // nombre de una sola palabra: solo si no hay dudas
  return ok.length ? ok[0].photo : null;
}
export async function addPhotos(data, photos, miss, fetchAf, log=console, max=MAX_FOTOS){
  const today = new Date().toISOString().slice(0,10), old = d => (Date.parse(today)-Date.parse(d))/864e5 > 14;
  const best = new Map();                                            // nombre -> goles (los más goleadores primero)
  for(const L of data) for(const [n,,g] of (L.scorers||[])) best.set(n, Math.max(g||0, best.get(n)||0));
  const todo = [...best].sort((x,y)=>y[1]-x[1]).map(x=>x[0]).filter(n=>!photos[n] && !(miss[n] && !old(miss[n])));
  let found=0, none=0, used=0;
  for(const n of todo.slice(0,max)){
    const last = plain(n).split(' ').reduce((a,b)=>b.length>=a.length?b:a,''); if(last.length<3){ miss[n]=today; continue; }
    const r = await fetchAf(`/players/profiles?search=${encodeURIComponent(last)}`); used++;
    const errs = r.errors && (Array.isArray(r.errors) ? r.errors.length : Object.keys(r.errors).length) ? JSON.stringify(r.errors) : '';
    if(errs){ log.warn(`[fotos] la API devolvió un error y se detiene: ${errs}`); break; }
    const url = findPhoto(n, r.response);
    if(url){ photos[n]=url; delete miss[n]; found++; } else { miss[n]=today; none++; }
  }
  log.log(`[fotos] ${used} búsquedas: ${found} con foto, ${none} sin coincidencia, ${Math.max(0,todo.length-used)} pendientes. En total hay ${Object.keys(photos).length} fotos.`);
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
  const data = await build(api, ctx.window.DATA, crests);
  const photos = ctx.window.PHOTOS || {}, miss = ctx.window.PHOTO_MISS || {};
  const afKey = process.env.API_FOOTBALL_KEY;
  if(afKey){
    try{
      const fetchAf = async p => { await new Promise(r=>setTimeout(r,7000)); const res = await fetch('https://v3.football.api-sports.io'+p,{headers:{'x-apisports-key':afKey}}); if(!res.ok) throw new Error(p+' -> '+res.status); return res.json(); };
      await addPhotos(data, photos, miss, fetchAf);
    }catch(e){ console.warn('[fotos] se omitieron por un error:', e.message); }
  } else console.log('[fotos] sin API_FOOTBALL_KEY: se omiten');
  fs.writeFileSync(file, '/* Generado por scripts/update.mjs (Argentina se edita a mano). */\nwindow.DATA = '+JSON.stringify(data,null,1)+';\nwindow.CRESTS = '+JSON.stringify(crests)+';\nwindow.PHOTOS = '+JSON.stringify(photos)+';\nwindow.PHOTO_MISS = '+JSON.stringify(miss)+';\n');
  console.log('data.js actualizado');
}
if (process.argv[1]===fileURLToPath(import.meta.url)) main();
