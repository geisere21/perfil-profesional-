/**
 * Un solo comando de despliegue. No publica si algo falla antes.
 *
 *   node scripts/desplegar.mjs
 *
 * 1. Importa medios, construye y corre el verificador AEO (32 criterios).
 * 2. Corre las pruebas en Chrome real contra el servidor local.
 * 3. Aplica las migraciones de D1 y publica en Cloudflare Pages con Wrangler
 *    (arrastrar la carpeta al dashboard no sube functions/).
 * 4. Comprueba en vivo que cada archivo publicado es idéntico al construido.
 * 5. Comprueba en vivo markdown, cabeceras, rangos y endpoint, y repite las
 *    pruebas de navegador contra la URL publicada (sin escribir en la base).
 */
import { execSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { RAIZ, DIST, PROYECTO_CF, D1_NOMBRE, PUERTO_LOCAL, leerSitio } from './config.mjs';

const sh = cmd => execSync(cmd, { stdio: 'inherit', cwd: RAIZ });
const paso = t => console.log(`\n━━ ${t} ${'━'.repeat(Math.max(0, 70 - t.length))}`);
const espera = ms => new Promise(r => setTimeout(r, ms));
const URL_SITIO = leerSitio().sitio.url;

paso('1. Medios, build y verificador');
sh('node scripts/importar-medios.mjs');
sh('node scripts/construir.mjs');
sh('node scripts/verificar-aeo.mjs ./dist');

paso('2. Pruebas en navegador (local)');
const ocupado = await new Promise(r => { const s = createConnection(PUERTO_LOCAL, '127.0.0.1').on('connect', () => { s.end(); r(true); }).on('error', () => r(false)); });
let servidor = null;
if (!ocupado) { servidor = spawn(process.execPath, ['scripts/servir.mjs'], { cwd: RAIZ, stdio: 'ignore' }); await espera(1500); }
try { sh('node scripts/pruebas-navegador.mjs'); }
finally { if (servidor) servidor.kill(); }

paso('3. Migraciones de D1 y publicación');
sh(`npx wrangler d1 migrations apply ${D1_NOMBRE} --remote`);
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: RAIZ }).toString().trim(); } catch { return 'sin-commit'; } })();
sh(`npx wrangler pages deploy dist --project-name ${PROYECTO_CF} --branch main --commit-dirty=true --commit-hash ${commit} --commit-message "Landing v2 ${new Date().toISOString().slice(0, 16)}"`);

paso('4. Lo publicado es idéntico a lo construido');
const lista = d => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? lista(join(d, f)) : [join(d, f)]);
const archivos = lista(DIST).map(f => relative(DIST, f).split(sep).join('/')).filter(f => !f.startsWith('_') && f !== '404.html');
const sha = b => createHash('sha256').update(b).digest('hex');
let distintos = [];
for (let intento = 1; intento <= 8; intento++) {
  distintos = [];
  await Promise.all(archivos.map(async f => {
    const ruta = f === 'index.html' ? '' : f;
    const r = await fetch(URL_SITIO + ruta, { headers: { 'Cache-Control': 'no-cache', Accept: f.endsWith('.html') ? 'text/html' : '*/*' } });
    const b = Buffer.from(await r.arrayBuffer());
    if (!r.ok || sha(b) !== sha(readFileSync(join(DIST, f)))) distintos.push(`${f} (${r.status})`);
  }));
  if (!distintos.length) break;
  console.log(`  intento ${intento}: ${distintos.length} archivos todavía distintos; espero…`);
  await espera(5000);
}
if (distintos.length) { console.error('Publicado distinto de lo construido:\n  ' + distintos.join('\n  ')); process.exit(1); }
console.log(`  ${archivos.length} archivos idénticos en ${URL_SITIO}`);

paso('5. Comprobaciones en vivo');
const fallos = [];
const md = await fetch(URL_SITIO, { headers: { Accept: 'text/markdown' } });
if (!/text\/markdown/.test(md.headers.get('content-type') || '')) fallos.push('Accept: text/markdown no devuelve markdown: ' + md.headers.get('content-type'));
const html = await fetch(URL_SITIO, { headers: { Accept: 'text/html' } });
if (!/describedby/.test(html.headers.get('link') || '')) fallos.push('Sin cabecera Link en la portada');
if (!/accept/i.test(html.headers.get('vary') || '')) fallos.push('Sin Vary: Accept');
const video = (/data-src="([^"]+\.mp4)"/.exec(await html.text()) || [])[1];
const rango = await fetch(URL_SITIO + video.slice(1), { headers: { Range: 'bytes=0-1023' } });
await rango.arrayBuffer();
if (rango.status !== 206) fallos.push(`El video no responde por rangos: ${rango.status}`);
const noExiste = await fetch(URL_SITIO + 'no-existe-' + Date.now());
if (noExiste.status !== 404) fallos.push(`Una ruta inexistente responde ${noExiste.status}`);
const get = await fetch(URL_SITIO + 'api/evento');
if (get.status !== 405) fallos.push(`GET /api/evento responde ${get.status}`);
const og = await fetch(URL_SITIO + 'miniatura.jpg');
if (!og.ok || Number(og.headers.get('content-length') || (await og.clone().arrayBuffer()).byteLength) > 300 * 1024) fallos.push('La miniatura no responde o pesa más de 300 KB');
console.log(`  markdown ${md.headers.get('content-type')} · Link ok · ${rango.status} ${rango.headers.get('content-range')} · 404 ok · /api/evento GET ${get.status}`);
if (fallos.length) { console.error('  ' + fallos.join('\n  ')); process.exit(1); }

sh(`node scripts/pruebas-navegador.mjs ${URL_SITIO} --en-vivo`);
console.log(`\nPublicado y verificado: ${URL_SITIO}`);
