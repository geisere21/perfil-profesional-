/**
 * Comprobaciones contra la URL publicada. Lo corre desplegar.mjs al final y se
 * puede correr solo, sin volver a publicar.
 *
 *   node scripts/comprobar-en-vivo.mjs
 *
 * 1. Cada archivo de dist/ es idéntico al publicado (SHA-256), con pocas
 *    descargas a la vez y reintentos: la conexión de Caracas no aguanta 60 en paralelo.
 * 2. Markdown por Accept, cabecera Link, Vary, 206 en el video, 404 y endpoint.
 * 3. Las pruebas en Chrome real contra la URL publicada, sin escribir en la base.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { RAIZ, DIST, leerSitio } from './config.mjs';

const URL_SITIO = leerSitio().sitio.url;
const espera = ms => new Promise(r => setTimeout(r, ms));
const sha = b => createHash('sha256').update(b).digest('hex');

async function traer(url, opciones = {}, intentos = 4) {
  for (let i = 1; ; i++) {
    try { return await fetch(url, { ...opciones, signal: AbortSignal.timeout(30000) }); }
    catch (e) { if (i >= intentos) throw e; await espera(1500 * i); }
  }
}

console.log('━━ Lo publicado es idéntico a lo construido');
const lista = d => readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? lista(join(d, f)) : [join(d, f)]);
const archivos = lista(DIST).map(f => relative(DIST, f).split(sep).join('/')).filter(f => !f.startsWith('_') && f !== '404.html');
let distintos = [];
for (let vuelta = 1; vuelta <= 6; vuelta++) {
  distintos = [];
  const cola = [...archivos];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cola.length) {
      const f = cola.shift();
      const r = await traer(URL_SITIO + (f === 'index.html' ? '' : f), { headers: { 'Cache-Control': 'no-cache', Accept: f.endsWith('.html') ? 'text/html' : '*/*' } });
      const b = Buffer.from(await r.arrayBuffer());
      if (!r.ok || sha(b) !== sha(readFileSync(join(DIST, f)))) distintos.push(`${f} (${r.status})`);
    }
  }));
  if (!distintos.length) break;
  console.log(`  vuelta ${vuelta}: ${distintos.length} todavía distintos (${distintos.slice(0, 3).join(', ')}); espero…`);
  await espera(6000);
}
if (distintos.length) { console.error('Publicado distinto de lo construido:\n  ' + distintos.join('\n  ')); process.exit(1); }
console.log(`  ${archivos.length} archivos idénticos en ${URL_SITIO}`);

console.log('━━ Cabeceras, markdown, rangos y endpoint');
const fallos = [];
const md = await traer(URL_SITIO, { headers: { Accept: 'text/markdown' } });
const textoMd = await md.text();
if (!/text\/markdown/.test(md.headers.get('content-type') || '') || !textoMd.startsWith('# ')) fallos.push('Accept: text/markdown no devuelve markdown: ' + md.headers.get('content-type'));
const html = await traer(URL_SITIO, { headers: { Accept: 'text/html' } });
const cuerpo = await html.text();
if (!/describedby/.test(html.headers.get('link') || '')) fallos.push('Sin cabecera Link en la portada');
if (!/accept/i.test(html.headers.get('vary') || '')) fallos.push('Sin Vary: Accept');
const video = (/data-src="([^"]+\.mp4)"/.exec(cuerpo) || [])[1];
const rango = await traer(URL_SITIO + video.slice(1), { headers: { Range: 'bytes=0-1023' } });
await rango.arrayBuffer();
if (rango.status !== 206) fallos.push(`El video no responde por rangos: ${rango.status}`);
const noExiste = await traer(URL_SITIO + 'no-existe-' + Date.now());
await noExiste.arrayBuffer();
if (noExiste.status !== 404) fallos.push(`Una ruta inexistente responde ${noExiste.status}`);
const get = await traer(URL_SITIO + 'api/evento');
if (get.status !== 405) fallos.push(`GET /api/evento responde ${get.status}`);
const og = await traer(URL_SITIO + 'miniatura.jpg');
const ogBytes = (await og.arrayBuffer()).byteLength;
if (!og.ok || ogBytes > 300 * 1024) fallos.push(`Miniatura: ${og.status}, ${Math.round(ogBytes / 1024)} KB`);
const robots = await (await traer(URL_SITIO + 'robots.txt')).text();
if (!/Content-Signal:/.test(robots) || !/ClaudeBot/.test(robots)) fallos.push('robots.txt en vivo sin Content-Signal o sin rastreadores');
console.log(`  markdown: ${md.headers.get('content-type')} (${textoMd.length} caracteres, ${md.headers.get('x-markdown-tokens')} tokens)`);
console.log(`  Link: ${html.headers.get('link') ? 'sí' : 'no'} · Vary: ${html.headers.get('vary')} · video: ${rango.status} ${rango.headers.get('content-range')}`);
console.log(`  404: ${noExiste.status} · GET /api/evento: ${get.status} · miniatura: ${Math.round(ogBytes / 1024)} KB`);
if (fallos.length) { console.error('  ' + fallos.join('\n  ')); process.exit(1); }

console.log('━━ Pruebas en navegador contra la URL publicada');
execSync(`node scripts/pruebas-navegador.mjs ${URL_SITIO} --en-vivo`, { stdio: 'inherit', cwd: RAIZ });
