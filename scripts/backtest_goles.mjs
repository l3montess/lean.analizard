// Prueba de los goles esperados: compara cómo estimar el total de goles de un partido sin ver su resultado.
// Variantes: últimos 10 (el viejo), últimos 5 solos, y últimos 5 mezclados con el promedio de la temporada (el nuevo, 60/40 y otros pesos).
// Mide: error medio del total de goles (menos = mejor), sesgo (promedio predicho − real, ideal 0) y Brier de "más de 2,5" y "ambos marcan".
// Uso: node scripts/backtest_goles.mjs   (necesita history.json, igual que backtest.mjs)
import fs from 'node:fs';
const file=new URL('../history.json',import.meta.url);
if(!fs.existsSync(file)){ console.error('Falta history.json'); process.exit(1); }
const H=JSON.parse(fs.readFileSync(file,'utf8'));
const pz=(k,l)=>{ let p=Math.exp(-l); for(let i=1;i<=k;i++) p*=l/i; return p; };
const av=(L,i)=>L.reduce((s,x)=>s+x[i],0)/L.length;
const VARS={ 'ultimos10 (viejo)':{n:10,w:1}, 'ultimos5 solos':{n:5,w:1}, '5 + temporada 60/40 (nuevo)':{n:5,w:.6}, '5 + temporada 40/60':{n:5,w:.4}, 'solo temporada':{n:5,w:0} };
const acc=Object.fromEntries(Object.keys(VARS).map(k=>[k,{n:0,ae:0,bias:0,bo:0,bb:0}]));
const byL={}; for(const r of H.partidos){ const [lg,se,date,h,a,hg,ag]=r; ((byL[lg]=byL[lg]||{})[se]=byL[lg][se]||[]).push({h,a,date,hg,ag}); }
for(const [lg,seasons] of Object.entries(byL)){
  const rec={}; for(const se of Object.keys(seasons).sort()){ const st={};
    for(const m of [...seasons[se]].sort((x,y)=>x.date<y.date?-1:1)){
      const fa=rec[m.h]||[], fb=rec[m.a]||[], sa=st[m.h], sb=st[m.a];
      if(fa.length>=10&&fb.length>=10&&sa&&sb&&sa.n>=3&&sb.n>=3){
        const real=m.hg+m.ag, over=real>2.5?1:0, both=m.hg>0&&m.ag>0?1:0;
        for(const [k,{n,w}] of Object.entries(VARS)){
          const A=fa.slice(-n), B=fb.slice(-n), r5A=(av(A,0)+av(B,1))/2, r5B=(av(B,0)+av(A,1))/2, sA=(sa.gf/sa.n+sb.ga/sb.n)/2, sB=(sb.gf/sb.n+sa.ga/sa.n)/2;
          const lA=w*r5A+(1-w)*sA, lB=w*r5B+(1-w)*sB, lt=lA+lB, po=1-(pz(0,lt)+pz(1,lt)+pz(2,lt)), pb=(1-Math.exp(-lA))*(1-Math.exp(-lB)), o=acc[k];
          o.n++; o.ae+=Math.abs(lt-real); o.bias+=lt-real; o.bo+=(po-over)**2; o.bb+=(pb-both)**2; } }
      (rec[m.h]=rec[m.h]||[]).push([m.hg,m.ag]); (rec[m.a]=rec[m.a]||[]).push([m.ag,m.hg]);
      for(const [t,g,c] of [[m.h,m.hg,m.ag],[m.a,m.ag,m.hg]]){ const s=st[t]=st[t]||{n:0,gf:0,ga:0}; s.n++; s.gf+=g; s.ga+=c; } } } }
console.table(Object.fromEntries(Object.entries(acc).map(([k,o])=>[k,{partidos:o.n,error_medio_goles:+(o.ae/o.n).toFixed(3),sesgo:+(o.bias/o.n).toFixed(3),brier_mas25:+(o.bo/o.n).toFixed(4),brier_ambos:+(o.bb/o.n).toFixed(4)}])));
