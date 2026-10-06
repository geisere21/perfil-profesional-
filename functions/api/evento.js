/**
 * Cuenta un evento de la página. Sin cookies, sin IP, sin agente de usuario:
 * solo tipo, origen y, en el panel de WhatsApp, el botón y las dos respuestas.
 * Los valores válidos salen de datos/sitio.json, la misma fuente que escribe
 * la nota de privacidad. Si no hay base de datos conectada, no guarda nada.
 */
import sitio from '../../datos/sitio.json' with { type: 'json' };

const TIPOS = new Set(Object.keys(sitio.medicion.eventos));
const ORIGENES = new Set(Object.keys(sitio.medicion.origenes));
const BOTONES = new Set(['nav', 'portada', 'barra', 'contacto', 'otro', ...sitio.servicios.map(s => 'servicio-' + s.slug)]);
const Q1 = new Set(sitio.whatsapp_panel.opciones1.map(o => o.valor));
const Q2 = new Set(sitio.whatsapp_panel.opciones2.map(o => o.valor));
const CAMPOS = new Set(['tipo', 'origen', 'boton', 'q1', 'q2']);
const AUTOMATAS = /bot|crawl|spider|slurp|headless|lighthouse|preview|python|curl|wget/i;

const vacia = estado => new Response(null, { status: estado, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env }) {
  const propio = new URL(request.url).origin;
  const sitioFetch = request.headers.get('Sec-Fetch-Site');
  const origenCabecera = request.headers.get('Origin');
  const mismoSitio = sitioFetch ? sitioFetch === 'same-origin' : origenCabecera === propio;
  if (!mismoSitio) return vacia(403);
  if (AUTOMATAS.test(request.headers.get('User-Agent') || '')) return vacia(204);

  const texto = await request.text();
  if (texto.length > 400) return vacia(413);
  let d;
  try { d = JSON.parse(texto); } catch { return vacia(400); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return vacia(400);
  if (Object.keys(d).some(k => !CAMPOS.has(k))) return vacia(400);
  if (!TIPOS.has(d.tipo) || !ORIGENES.has(d.origen)) return vacia(400);
  if (d.boton !== undefined && !BOTONES.has(d.boton)) return vacia(400);
  if (d.q1 !== undefined && !Q1.has(d.q1)) return vacia(400);
  if (d.q2 !== undefined && !Q2.has(d.q2)) return vacia(400);
  if (d.tipo === 'whatsapp_enviado' && (!d.q1 || !d.q2)) return vacia(400);

  if (!env.DB) return vacia(204);
  await env.DB.prepare('INSERT INTO eventos (tipo, origen, boton, q1, q2) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(d.tipo, d.origen, d.boton ?? null, d.q1 ?? null, d.q2 ?? null).run();
  return vacia(204);
}

export function onRequest() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
