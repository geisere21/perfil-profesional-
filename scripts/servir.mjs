/**
 * Servidor local de revisión. Ejecuta las mismas Functions que Cloudflare
 * Pages (middleware de markdown y /api/evento) sobre dist/, responde por
 * rangos (206) como pide Safari para el video y aplica dist/_headers.
 * Los eventos van a una base SQLite local (.cache/local.db), no a la real.
 *
 *   node scripts/servir.mjs            → http://localhost:8098 y la IP de la red
 *   GET /__eventos                     → lo que se ha contado en local (solo aquí)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, createReadStream } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { DIST, CACHE, RAIZ, PUERTO_LOCAL } from './config.mjs';
import * as middleware from '../functions/_middleware.js';
import * as evento from '../functions/api/evento.js';
import * as video from '../functions/video/[[ruta]].js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2'
};

// ── Base local con la misma forma mínima que D1 ───────────────────────────
mkdirSync(CACHE, { recursive: true });
const sqlite = new DatabaseSync(join(CACHE, 'local.db'));
sqlite.exec(readFileSync(join(RAIZ, 'migrations', '0001_eventos.sql'), 'utf8'));
const DB = {
  prepare(sql) {
    const st = sqlite.prepare(sql.replace(/\?(\d+)/g, '?'));
    let valores = [];
    return { bind(...v) { valores = v; return this; }, async run() { st.run(...valores); return { success: true }; }, async all() { return { results: st.all(...valores) }; } };
  }
};

// ── _headers de dist ──────────────────────────────────────────────────────
function leerCabeceras() {
  const f = join(DIST, '_headers');
  if (!existsSync(f)) return [];
  const reglas = [];
  let actual = null;
  for (const linea of readFileSync(f, 'utf8').split('\n')) {
    if (!linea.trim()) continue;
    if (!/^\s/.test(linea)) { actual = { patron: linea.trim(), cabeceras: [] }; reglas.push(actual); continue; }
    const i = linea.indexOf(':');
    actual.cabeceras.push([linea.slice(0, i).trim(), linea.slice(i + 1).trim()]);
  }
  return reglas;
}
const coincide = (patron, ruta) => patron.endsWith('*') ? ruta.startsWith(patron.slice(0, -1)) : patron === ruta;

function estatico(request) {
  const url = new URL(request.url);
  let ruta = decodeURIComponent(url.pathname);
  if (ruta.endsWith('/')) ruta += 'index.html';
  const archivo = normalize(join(DIST, ruta));
  const existe = archivo.startsWith(DIST) && existsSync(archivo) && statSync(archivo).isFile() && !ruta.startsWith('/_');
  const final = existe ? archivo : join(DIST, '404.html');
  const estado = existe ? 200 : 404;
  const cabeceras = new Headers({ 'Content-Type': TIPOS[extname(final)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' });
  for (const regla of leerCabeceras()) if (coincide(regla.patron, url.pathname)) for (const [k, v] of regla.cabeceras) cabeceras.set(k, v);
  const total = statSync(final).size;
  const rango = request.headers.get('Range');
  if (existe && rango) {
    const m = /bytes=(\d*)-(\d*)/.exec(rango);
    let inicio = m[1] === '' ? total - Number(m[2]) : Number(m[1]);
    let fin = m[1] !== '' && m[2] !== '' ? Number(m[2]) : total - 1;
    fin = Math.min(fin, total - 1);
    if (inicio > fin || inicio >= total) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    cabeceras.set('Content-Range', `bytes ${inicio}-${fin}/${total}`);
    cabeceras.set('Content-Length', String(fin - inicio + 1));
    return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(final, { start: inicio, end: fin })), { status: 206, headers: cabeceras });
  }
  // Texto comprimido como lo entrega Cloudflare, para que las mediciones locales se parezcan a producción.
  const aceptadas = request.headers.get('Accept-Encoding') || '';
  if (/\.(html|css|js|json|md|txt|xml)$/.test(final) && /\b(br|gzip)\b/.test(aceptadas)) {
    const br = /\bbr\b/.test(aceptadas);
    const cuerpo = br ? brotliCompressSync(readFileSync(final)) : gzipSync(readFileSync(final));
    cabeceras.set('Content-Encoding', br ? 'br' : 'gzip');
    cabeceras.set('Content-Length', String(cuerpo.length));
    cabeceras.append('Vary', 'Accept-Encoding');
    return new Response(request.method === 'HEAD' ? null : cuerpo, { status: estado, headers: cabeceras });
  }
  cabeceras.set('Content-Length', String(total));
  return new Response(request.method === 'HEAD' ? null : readFileSync(final), { status: estado, headers: cabeceras });
}

async function atender(request) {
  const url = new URL(request.url);
  if (url.pathname === '/__eventos') return Response.json(sqlite.prepare('SELECT * FROM eventos ORDER BY id').all());
  if (url.pathname === '/api/evento') {
    const env = { DB };
    return request.method === 'POST' ? evento.onRequestPost({ request, env }) : evento.onRequest({ request, env });
  }
  if (url.pathname.startsWith('/video/')) return video.onRequest({ request, env: { ASSETS: { fetch: r => estatico(new Request(r.url)) } } });
  if (url.pathname.endsWith('/')) {
    return middleware.onRequest({ request, env: { ASSETS: { fetch: u => estatico(new Request(u)) } }, next: () => estatico(request) });
  }
  return estatico(request);
}

createServer(async (req, res) => {
  try {
    const cuerpo = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Response(Readable.toWeb(req)).arrayBuffer();
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: cuerpo });
    const r = await atender(request);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (r.body && req.method !== 'HEAD') Readable.fromWeb(r.body).pipe(res); else res.end();
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('Error');
  }
}).listen(PUERTO_LOCAL, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Sirviendo dist/ en http://localhost:${PUERTO_LOCAL}`);
  for (const ip of ips) console.log(`  desde el teléfono (misma red): http://${ip}:${PUERTO_LOCAL}`);
});
