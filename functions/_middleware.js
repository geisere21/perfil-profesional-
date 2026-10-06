/**
 * Markdown para agentes (lo que isitagentready llama «Markdown negotiation»).
 * Si el Accept prefiere text/markdown, entrega <ruta>/index.md generado en el
 * build. Al HTML le suma Vary: Accept y la cabecera Link de la portada.
 * _routes.json limita esta Function a las páginas: los estáticos no la pasan.
 */
import enlaces from './_enlaces.json' with { type: 'json' };

function prefiereMarkdown(accept) {
  if (!accept) return false;
  let md = -1, html = -1;
  for (const parte of accept.split(',')) {
    const [tipo, ...params] = parte.trim().split(';').map(x => x.trim());
    const qParam = params.find(x => x.startsWith('q='));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    const t = tipo.toLowerCase();
    if (t === 'text/markdown') md = Math.max(md, q);
    if (t === 'text/html') html = Math.max(html, q);
  }
  return md > 0 && md >= html;
}

export async function onRequest(contexto) {
  const { request, next, env } = contexto;
  const url = new URL(request.url);
  const esPagina = url.pathname.endsWith('/');
  if (!esPagina || !['GET', 'HEAD'].includes(request.method)) return next();

  if (prefiereMarkdown(request.headers.get('Accept'))) {
    const r = await env.ASSETS.fetch(new URL(url.pathname + 'index.md', url.origin));
    if (r.ok) {
      const cuerpo = await r.text();
      return new Response(request.method === 'HEAD' ? null : cuerpo, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Vary': 'Accept',
          'Link': `<${url.pathname}>; rel="alternate"; type="text/html"`,
          'x-markdown-tokens': String(Math.ceil(cuerpo.length / 4)),
          'Cache-Control': 'public, max-age=0, must-revalidate',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }
  }

  const respuesta = await next();
  const cabeceras = new Headers(respuesta.headers);
  const vary = cabeceras.get('Vary');
  cabeceras.set('Vary', vary ? (/\baccept\b/i.test(vary) ? vary : vary + ', Accept') : 'Accept');
  if ((cabeceras.get('Content-Type') || '').includes('text/html') && url.pathname === '/') cabeceras.set('Link', enlaces.portada);
  return new Response(respuesta.body, { status: respuesta.status, statusText: respuesta.statusText, headers: cabeceras });
}
