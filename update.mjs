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
    if(!code){ out.push(prev); continue; }               // Argentina y Europa League: sin cambios
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
  fs.writeFileSync(file, '/* Generado por scripts/update.mjs (Argentina se edita a mano). */\nwindow.DATA = '+JSON.stringify(data,null,1)+';\nwindow.CRESTS = '+JSON.stringify(crests)+';\n');
  console.log('data.js actualizado');
}
if (process.argv[1]===fileURLToPath(import.meta.url)) main();
