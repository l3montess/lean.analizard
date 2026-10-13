# Dato Duro

Dashboard de estadísticas de fútbol (Argentina, Inglaterra, España, Francia, Alemania, Italia).
Es un sitio estático: `index.html` + `data.js`. No necesita servidor ni instalar nada.

## 1. Subirlo a tu propio sitio (la forma más simple)
1. Entrá a https://app.netlify.com/drop (o a Cloudflare Pages) y arrastrá esta carpeta. Tenés link en un minuto.
2. Para tener tu dominio (por ejemplo datoduro.com): comprá el dominio en cualquier registrador y conectalo desde "Domain settings" de Netlify o Cloudflare. Ellos te guían con los DNS.

## 2. Que los datos se actualicen solos
1. Creá una cuenta gratis en https://www.football-data.org y copiá tu clave (API token).
2. Subí esta carpeta a un repositorio de GitHub y conectá ese repositorio a Netlify o Cloudflare Pages, así se publica solo con cada cambio.
3. En GitHub: Settings > Secrets and variables > Actions > New repository secret. Nombre `FOOTBALL_DATA_KEY`, valor tu clave.
4. Listo: `.github/workflows/update.yml` corre todos los días, ejecuta `scripts/update.mjs`, guarda el nuevo `data.js` y el sitio se republica.
   Podés correrlo a mano desde la pestaña Actions > "Actualizar datos" > Run workflow.

Qué se actualiza: tabla, goleadores, forma (últimos 5) y próxima jornada de Premier, LaLiga, Serie A, Bundesliga, Ligue 1 y Champions League.
Qué no: la Liga Argentina y la Europa League (el plan gratuito de esa API no las incluye). Se editan a mano en `data.js`, bloques `id:'arg'` y `id:'uel'`.

Importante:
- Las probabilidades de la próxima jornada pasan a ser de un modelo de Poisson simple calculado con los goles de la temporada, no del proveedor que usé en la primera versión. La página lo aclara.
- El script no pudo probarse contra la API real, solo con datos simulados. Si el primer Action falla, mirá el log y pasámelo.
- Tarjetas y córners no vienen en el plan gratuito de football-data.org.

## Editar la Liga Argentina
Cada equipo es una fila: `['Nombre', PJ, PG, PE, PP, GF, GC, Pts]`.
