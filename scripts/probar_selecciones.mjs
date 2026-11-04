// Prueba si API-Football (la clave que ya usamos para fotos) trae la UEFA Nations League y qué datos da.
// Solo lee e imprime en el log. No cambia nada del sitio.
const key = process.env.API_FOOTBALL_KEY;
if(!key){ console.error('Falta API_FOOTBALL_KEY (Settings → Secrets → Actions)'); process.exit(1); }
const get = async p => { const r = await fetch('https://v3.football.api-sports.io'+p,{headers:{'x-apisports-key':key}}); const j = await r.json(); return {status:r.status, j}; };
const show = (t,v)=>console.log('\n== '+t+' ==\n'+(typeof v==='string'?v:JSON.stringify(v,null,1)));
const st = await get('/status'); show('Cuenta', {plan:st.j.response?.subscription, usadas:st.j.response?.requests});
const found=[];
for(const q of ['?id=5','?search=nations','?search=uefa','?search=friendlies','?id=10']){ const r=await get('/leagues'+q); show('Búsqueda /leagues'+q, {estado:r.status, errores:r.j.errors, encontradas:(r.j.response||[]).slice(0,6).map(x=>({id:x.league.id,nombre:x.league.name,pais:x.country.name,temporadas:x.seasons.map(s=>s.year).slice(-4)}))}); (r.j.response||[]).forEach(x=>found.push(x)); }
const id = found.find(x=>x.league.id===5)?.league.id;
if(!id){ console.log('\nNo se encontró la Nations League (id 5) con este plan.'); process.exit(0); }
for(const season of [2026,2024]){
  const fx = await get(`/fixtures?league=${id}&season=${season}`);
  show(`Partidos temporada ${season}`, {estado:fx.status, errores:fx.j.errors, cantidad:(fx.j.response||[]).length, ejemplo:(fx.j.response||[]).slice(0,3).map(f=>`${f.fixture.date.slice(0,10)} ${f.teams.home.name} vs ${f.teams.away.name} (${f.fixture.status.short})`)});
  const ts = await get(`/standings?league=${id}&season=${season}`);
  show(`Tablas temporada ${season}`, {errores:ts.j.errors, grupos:(ts.j.response?.[0]?.league?.standings||[]).length});
}
