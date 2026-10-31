// Prueba del modelo premium: simula partidos anteriores y mide si ANA acierta goles (+1,5), córners, tarjetas y remates al arco.
// El modelo solo usa lo que se sabía ANTES de cada partido (mismo cálculo que model.retro). Compara contra un método simple (siempre lo más frecuente / promedio de la liga).
// Uso: node scripts/backtest_premium.mjs   (necesita history.json, igual que backtest.mjs). Opcional: DIAS=730 para limitar a los últimos N días.
import fs from 'node:fs';
import { buildModel } from './model.mjs';
const file=new URL('../history.json',import.meta.url);
if(!fs.existsSync(file)){ console.error('Falta history.json'); process.exit(1); }
const hist=JSON.parse(fs.readFileSync(file,'utf8')), model=buildModel(hist);
const dias=process.env.DIAS?+process.env.DIAS:3650, rows=model.retro(dias,true);
const EVEN_MAX=45, EVEN_GAP=15, pz=(k,l)=>{ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; };
const pc=(a,b)=>b?(100*a/b).toFixed(1)+' %':'–', f3=x=>x.toFixed(3);
const mk=()=>({res:[0,0],g15:[0,0],g15base:0,brier:0,brierBase:0,cor:[0,0],corAE:0,corAEbase:0,corN:0,car:[0,0],carAE:0,carAEbase:0,carN:0,sot:[0,0],bucket:{}});
const T={}, ALL=mk(); const lgs=[...new Set(rows.map(r=>r[0]))];
// promedio real de la liga (para el método simple de córners y tarjetas)
const avg={}; for(const lg of lgs){ const R=rows.filter(r=>r[0]===lg&&r[22]!=null&&r[23]!=null&&r[24]!=null&&r[25]!=null); avg[lg]={cor:R.reduce((s,r)=>s+r[22]+r[23],0)/(R.length||1),car:R.reduce((s,r)=>s+r[24]+r[25],0)/(R.length||1)}; }
const over=rows.filter(r=>r[7]+r[8]>1.5).length/(rows.length||1);
for(const r of rows){ for(const o of [T[r[0]]=T[r[0]]||mk(),ALL]){
  const [p1,px,p2]=[r[4],r[5],r[6]], s=p1>=p2?0:2, mx=Math.max(p1,px,p2), even=mx<EVEN_MAX||Math.abs(p1-p2)<EVEN_GAP, res=r[7]>r[8]?0:r[7]===r[8]?1:2, hit=even?(res===s||res===1):res===s;
  o.res[1]++; if(hit) o.res[0]++;
  if(r[11]!=null&&r[12]!=null){ const lt=r[11]+r[12], p=1-(pz(0,lt)+pz(1,lt)), y=r[7]+r[8]>1.5?1:0, pick=p>=0.5?1:0; o.g15[1]++; if(pick===y) o.g15[0]++; if(y===1) o.g15base++; o.brier+=(p-y)**2; o.brierBase+=(over-y)**2;
    const b=p<.6?'50-60':p<.7?'60-70':p<.8?'70-80':p<.9?'80-90':'90+'; const q=o.bucket[(pick?'+1,5 ':'-1,5 ')+b]=o.bucket[(pick?'+1,5 ':'-1,5 ')+b]||[0,0]; q[1]++; if(pick===y) q[0]++; }
  if(r[18]!=null&&r[22]!=null&&r[23]!=null){ const d=r[18]-r[19], rd=r[22]-r[23]; if(Math.abs(d)>=1){ o.cor[1]++; if((d>0&&rd>0)||(d<0&&rd<0)) o.cor[0]++; } o.corN++; o.corAE+=Math.abs((r[18]+r[19])-(r[22]+r[23])); o.corAEbase+=Math.abs(avg[r[0]].cor-(r[22]+r[23])); }
  if(r[20]!=null&&r[24]!=null&&r[25]!=null){ const d=r[20]-r[21], rd=r[24]-r[25]; if(Math.abs(d)>=0.4){ o.car[1]++; if((d>0&&rd>0)||(d<0&&rd<0)) o.car[0]++; } o.carN++; o.carAE+=Math.abs((r[20]+r[21])-(r[24]+r[25])); o.carAEbase+=Math.abs(avg[r[0]].car-(r[24]+r[25])); }
  if(r[15]!=null&&r[13]!=null&&r[14]!=null){ const d=r[15]-r[16], rd=r[13]-r[14]; if(Math.abs(d)>=1){ o.sot[1]++; if((d>0&&rd>0)||(d<0&&rd<0)) o.sot[0]++; } } } }
const line=(n,o)=>({ liga:n, partidos:o.res[1], 'resultado (gana/empata/pierde)':pc(...o.res), '+1,5 goles acierta':pc(...o.g15), '+1,5 siempre-sí (base)':pc(o.g15base,o.g15[1]), 'Brier +1,5 (menos=mejor)':o.g15[1]?f3(o.brier/o.g15[1]):'–', 'Brier base':o.g15[1]?f3(o.brierBase/o.g15[1]):'–',
  'córners: quién tiene más':pc(...o.cor), 'córners error total (ANA | promedio liga)':o.corN?f3(o.corAE/o.corN)+' | '+f3(o.corAEbase/o.corN):'–', 'tarjetas: quién tiene más':pc(...o.car), 'tarjetas error total (ANA | promedio liga)':o.carN?f3(o.carAE/o.carN)+' | '+f3(o.carAEbase/o.carN):'–', 'remates: quién tiene más':pc(...o.sot) });
console.log(`Partidos simulados: ${rows.length} (sin ver su resultado). Método simple de +1,5 goles = decir siempre que sí (${(100*over).toFixed(1)} % de los partidos).`);
console.table(Object.fromEntries([...lgs.map(l=>[l,line(l,T[l])]),['TOTAL',line('TOTAL',ALL)]]));
console.log('\nCalibración de +1,5 goles (qué tan seguido acierta según la probabilidad que daba):'); console.table(Object.fromEntries(Object.entries(ALL.bucket).sort().map(([k,[a,n]])=>[k,{partidos:n,aciertos:pc(a,n)}])));
console.log('\nLectura: córners y tarjetas "quién tiene más" miden solo partidos donde ANA esperaba una diferencia clara (1 córner / 0,4 tarjetas) y un empate cuenta como fallo. Si el acierto no supera ~55 %, el dato no aporta.');
