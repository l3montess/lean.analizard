// Baja el historial de resultados y cuotas de football-data.co.uk (CSV gratuitos) y lo guarda en history.json.
// Sirve para entrenar y probar el modelo con varias temporadas, y para comparar contra las cuotas del mercado.
// Uso: node scripts/history.mjs            (no necesita clave)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const LEAGUES = { epl:'E0', esp:'SP1', ita:'I1', ger:'D1', fra:'F1' };
const BASE = 'https://www.football-data.co.uk/mmz4281';

// Temporadas a bajar, p. ej. 2024 -> "2425". Por defecto: la actual y las 4 anteriores.
export function seasonCodes(now=new Date(), n=5){
  const cur = now.getUTCMonth()>=6 ? now.getUTCFullYear() : now.getUTCFullYear()-1;
  return Array.from({length:n},(_,i)=>{ const y=cur-i; return String(y).slice(2)+String(y+1).slice(2); }).reverse();
}

// CSV simple (con comillas y comas dentro de comillas).
export function parseCsv(text){
  const rows=[]; let row=[], cell='', q=false;
  text=text.replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=c; }
    else if(c==='"') q=true;
    else if(c===','){ row.push(cell); cell=''; }
    else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(cell); cell=''; if(row.some(x=>x!=='')) rows.push(row); row=[]; }
    else cell+=c;
  }
  if(cell!==''||row.length){ row.push(cell); if(row.some(x=>x!=='')) rows.push(row); }
  return rows;
}

// "17/10/2025" o "17/10/25" -> "2025-10-17"
export function isoDate(s, time){
  const m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s||'').trim()); if(!m) return null;
  let y=+m[3]; if(y<100) y+= y>=70?1900:2000;
  const d=`${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  return /^\d{1,2}:\d{2}$/.test(time||'') ? `${d}T${String(time).padStart(2,'0')}` : d;
}

const num = v => { const x=parseFloat(v); return Number.isFinite(x)?x:null; };
// Primer grupo de columnas que tenga las 3 cuotas: cierre del promedio, promedio, cierre de Bet365, Bet365.
const ODDS_SETS = [['AvgCH','AvgCD','AvgCA'],['AvgH','AvgD','AvgA'],['B365CH','B365CD','B365CA'],['B365H','B365D','B365A']];
const OU_SETS = [['AvgC>2.5','AvgC<2.5'],['Avg>2.5','Avg<2.5'],['B365C>2.5','B365C<2.5'],['B365>2.5','B365<2.5']];

// Una fila de CSV -> partido compacto, o null si no sirve.
export function toMatch(league, season, head, r){
  const g = k => { const i=head.indexOf(k); return i<0?undefined:r[i]; };
  const date=isoDate(g('Date'), g('Time')), h=(g('HomeTeam')||'').trim(), a=(g('AwayTeam')||'').trim();
  const hg=num(g('FTHG')), ag=num(g('FTAG'));
  if(!date||!h||!a||hg==null||ag==null) return null;      // partido sin jugar o fila rota
  let odds=null; for(const s of ODDS_SETS){ const v=s.map(k=>num(g(k))); if(v.every(x=>x>1)){ odds=v; break; } }
  let ou=null;   for(const s of OU_SETS){ const v=s.map(k=>num(g(k))); if(v.every(x=>x>1)){ ou=v; break; } }
  const sh=['HS','AS','HST','AST'].map(k=>num(g(k)));          // remates y remates al arco (local, visita)
  const o=[league,season,date,h,a,hg,ag, ...(odds||[null,null,null]), ...(ou||[null,null]), ...sh];
  return o;
}

export function parseSeason(league, season, text){
  const rows=parseCsv(text); if(rows.length<2) return [];
  const head=rows[0].map(x=>x.trim());
  if(!head.includes('HomeTeam')||!head.includes('FTHG')) throw new Error('formato inesperado');
  return rows.slice(1).map(r=>toMatch(league,season,head,r)).filter(Boolean);
}

async function main(){
  const seasons=seasonCodes(); const all=[]; let ok=0, fail=0;
  for(const [league,code] of Object.entries(LEAGUES)) for(const s of seasons){
    const url=`${BASE}/${s}/${code}.csv`;
    try{
      const res=await fetch(url); if(!res.ok) throw new Error('HTTP '+res.status);
      const ms=parseSeason(league,s,await res.text()); all.push(...ms); ok++;
      console.log(`${league} ${s}: ${ms.length} partidos`);
    }catch(e){ fail++; console.warn(`${league} ${s}: omitido (${e.message})`); }
    await new Promise(r=>setTimeout(r,500));            // sin apuro: es un servicio gratuito
  }
  if(!ok){ console.error('No se pudo bajar nada: no se toca history.json'); process.exit(1); }
  all.sort((x,y)=>x[2]<y[2]?-1:x[2]>y[2]?1:0);
  const out={ generado:new Date().toISOString(), fuente:'football-data.co.uk', columnas:'liga,temporada,fecha,local,visita,golesL,golesV,cuotaL,cuotaX,cuotaV,mas2.5,menos2.5,rematesL,rematesV,alArcoL,alArcoV (null si falta)', partidos:all };
  fs.writeFileSync(new URL('../history.json',import.meta.url), JSON.stringify(out));
  console.log(`history.json: ${all.length} partidos (${ok} archivos, ${fail} omitidos)`);
}
if (process.argv[1]===fileURLToPath(import.meta.url)) main();
