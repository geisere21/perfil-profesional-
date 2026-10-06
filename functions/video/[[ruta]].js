/**
 * Videos con soporte de rangos (206).
 *
 * Cloudflare Pages entrega los estáticos completos con 200 aunque el navegador
 * pida un rango (comprobado el 6 oct 2026 en este proyecto y en 365-build).
 * Safari en iPhone no reproduce un video si no recibe 206: por eso los videos
 * viven en /video/ y pasan por aquí. _routes.json manda solo /video/* a esta
 * Function; las imágenes siguen sin invocaciones.
 */
export async function onRequest({ request, env }) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });

  const activo = await env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));
  if (!activo.ok) return activo;

  const cabeceras = new Headers({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=604800',
    'X-Content-Type-Options': 'nosniff'
  });
  const etag = activo.headers.get('ETag');
  if (etag) cabeceras.set('ETag', etag);

  const rango = request.headers.get('Range');
  if (!rango) {
    const largo = activo.headers.get('Content-Length');
    if (largo) cabeceras.set('Content-Length', largo);
    return new Response(request.method === 'HEAD' ? null : activo.body, { status: 200, headers: cabeceras });
  }

  const datos = await activo.arrayBuffer();
  const total = datos.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rango.trim());
  if (!m || (m[1] === '' && m[2] === '')) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
  let inicio, fin;
  if (m[1] === '') { inicio = Math.max(0, total - Number(m[2])); fin = total - 1; }
  else { inicio = Number(m[1]); fin = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1); }
  if (inicio > fin || inicio >= total) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });

  cabeceras.set('Content-Range', `bytes ${inicio}-${fin}/${total}`);
  cabeceras.set('Content-Length', String(fin - inicio + 1));
  return new Response(request.method === 'HEAD' ? null : datos.slice(inicio, fin + 1), { status: 206, headers: cabeceras });
}
