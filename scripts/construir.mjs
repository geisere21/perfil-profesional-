/**
 * Construye dist/ desde datos/sitio.json.
 *
 *   node scripts/construir.mjs
 *
 * Genera: index.html, 404.html, index.md, llms.txt, llms-full.txt (desde el
 * HTML ya construido), robots.txt, sitemap.xml, _headers, _routes.json, la
 * miniatura de 1200 × 630, los íconos, las variantes de cada medio y la tabla
 * de contraste. Además deja en la raíz del repo la redirección que publica
 * GitHub Pages en la URL vieja.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { RAIZ, DIST, leerSitio, mediosUsados } from './config.mjs';
import { procesarImagen, procesarVideo, publicar } from './lib/procesar-medios.mjs';
import { generarOgEIconos } from './lib/og.mjs';
import { htmlAMarkdown } from './lib/markdown.mjs';
import { pagina, pagina404, esc } from '../src/plantilla.mjs';

const t0 = Date.now();
const s = leerSitio();
const URL_SITIO = s.sitio.url;
const avisos = [];

// ── 1. Validación de datos ─────────────────────────────────────────────────
function validar() {
  const errores = [];
  // Toda cifra lleva fuente.
  for (const c of s.casos) for (const x of c.cifras) if (!x.fuente) errores.push(`Cifra sin fuente en ${c.slug}: ${x.valor} ${x.etiqueta}`);
  // Todo texto con dígitos tiene una fuente en su objeto o en uno que lo contiene.
  const CLAVES_LIBRES = new Set(['url', 'url_anterior', 'sameAs', 'instagram_usuario', 'whatsapp', 'whatsapp_visible', 'src', 'poster', 'destino', 'fuente', 'seguimiento_clics', 'linkedin_texto']);
  const recorrer = (nodo, ruta, conFuente) => {
    if (Array.isArray(nodo)) return nodo.forEach((v, i) => recorrer(v, `${ruta}[${i}]`, conFuente));
    if (nodo && typeof nodo === 'object') {
      const f = conFuente || Boolean(nodo.fuente);
      for (const [k, v] of Object.entries(nodo)) if (!CLAVES_LIBRES.has(k)) recorrer(v, `${ruta}.${k}`, f);
      return;
    }
    if (typeof nodo === 'string' && /\d/.test(nodo) && !conFuente && !ruta.startsWith('$.whatsapp_panel.pregunta')) errores.push(`Texto con cifra y sin fuente: ${ruta} = "${nodo}"`);
  };
  recorrer(s, '$', false);
  if (s.resenas.activo && !s.resenas.items.length) errores.push('Bloque de reseñas encendido sin reseñas reales');
  for (const [ruta, activa] of Object.entries(s.rutas_preparadas)) if (activa) errores.push(`La ruta «${ruta}» está encendida y no existe en V2`);
  if (!s.persona.whatsapp) avisos.push('WhatsApp en null: los botones de WhatsApp no se pintan.');
  if (!s.persona.sameAs.length) avisos.push('sameAs vacío: la identidad no queda cosida a ningún perfil.');
  if (errores.length) { console.error('Datos inválidos:\n  ' + errores.join('\n  ')); process.exit(1); }
}
validar();

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// ── 2. Medios ──────────────────────────────────────────────────────────────
const dMedios = join(DIST, 'medios');
const imagenes = {};
const videos = {};
const fotos = new Set([s.persona.foto_perfil, s.como_trabajo.foto.src, s.fuera.foto.src,
  ...s.casos.flatMap(c => c.media.filter(m => m.foto).map(m => m.src))]);
const posters = new Set([s.portada.video.poster, s.fuera.video.poster, ...s.casos.flatMap(c => c.media.filter(m => m.poster).map(m => m.poster))]);

for (const nombre of mediosUsados(s)) {
  if (nombre.endsWith('.mp4')) {
    const v = procesarVideo(nombre);
    publicar(v.archivo, join(DIST, 'video'));   // pasan por functions/video: Pages no responde 206 a los estáticos
    videos[nombre] = { ...v, url: '/video/' + v.archivo };
    continue;
  }
  const opciones = nombre === s.portada.video.poster ? { anchos: [640, 960, 1280], anchoJpg: 960 }
    : posters.has(nombre) ? { anchos: [480, 800], anchoJpg: 800 }
    : { anchos: [480, 800, 1200], foto: fotos.has(nombre), anchoJpg: 800 };
  const i = procesarImagen(nombre, opciones);
  i.webp.forEach(v => publicar(v.archivo, dMedios));
  publicar(i.jpg.archivo, dMedios);
  imagenes[nombre] = { ...i, webp: i.webp.map(v => ({ ...v, url: '/medios/' + v.archivo })), jpg: { ...i.jpg, url: '/medios/' + i.jpg.archivo } };
}

// ── 3. Fuentes y scripts ───────────────────────────────────────────────────
const nm = join(RAIZ, 'node_modules');
const dFuentes = join(DIST, 'fuentes');
mkdirSync(dFuentes, { recursive: true });
const FUENTES = {
  'anton-400.woff2': '@fontsource/anton/files/anton-latin-400-normal.woff2',
  'playfair-600-italic.woff2': '@fontsource/playfair-display/files/playfair-display-latin-600-italic.woff2',
  'inter-400.woff2': '@fontsource/inter/files/inter-latin-400-normal.woff2',
  'inter-600.woff2': '@fontsource/inter/files/inter-latin-600-normal.woff2'
};
for (const [destino, origen] of Object.entries(FUENTES)) copyFileSync(join(nm, origen), join(dFuentes, destino));

const huella = b => createHash('sha256').update(b).digest('hex').slice(0, 10);
const dJs = join(DIST, 'js');
mkdirSync(dJs, { recursive: true });
const versionGsap = JSON.parse(readFileSync(join(nm, 'gsap', 'package.json'), 'utf8')).version;
const js = {};
for (const [clave, archivo] of [['gsap', 'gsap.min.js'], ['scrollTrigger', 'ScrollTrigger.min.js'], ['splitText', 'SplitText.min.js']]) {
  const nombre = archivo.replace('.min.js', `-${versionGsap}.min.js`);
  copyFileSync(join(nm, 'gsap', 'dist', archivo), join(dJs, nombre));
  js[clave] = '/js/' + nombre;
}
const appJs = readFileSync(join(RAIZ, 'src', 'app.js'));
js.app = `/js/app.${huella(appJs)}.js`;
writeFileSync(join(DIST, js.app), appJs);

const css = readFileSync(join(RAIZ, 'src', 'estilos.css'));
const rutaCss = `/css/estilos.${huella(css)}.css`;
mkdirSync(join(DIST, 'css'), { recursive: true });
writeFileSync(join(DIST, rutaCss), css);

// ── 4. Miniatura e íconos ──────────────────────────────────────────────────
const og = await generarOgEIconos(s, {
  rutaAnton: join(dFuentes, 'anton-400.woff2'),
  rutaInter600: join(dFuentes, 'inter-600.woff2'),
  rutaFoto: join(RAIZ, 'medios', 'geiser-push-roll-escenario.jpg'),
  distDir: DIST
});

// ── 5. Privacidad, configuración del navegador y datos estructurados ──────
const endpoint = s.conexiones.seguimiento_clics;
const enumerar = (lista, y = 'y') => lista.length < 2 ? lista.join('') : lista.slice(0, -1).join(', ') + ` ${y} ` + lista.at(-1);
const origenes = Object.entries(s.medicion.origenes).filter(([k]) => k !== 'directo').map(([, v]) => v);
const privacidad = endpoint
  ? `Esta página no usa cookies, no guarda tu IP y no te identifica. Cuenta, sin datos personales: ${Object.values(s.medicion.eventos).join('; ')}. Para saber de dónde llegas, la página mira la dirección anterior o la etiqueta del enlace: ${enumerar(origenes, 'u')}, o directo si no hay ninguna. Los conteos quedan en mi cuenta de Cloudflare, que aloja la página y recibe cada visita como cualquier servidor, y no los comparto con nadie. No hay formularios: lo que me escribes por WhatsApp o por correo no pasa por aquí.`
  : 'Esta página no mide nada: no usa cookies ni scripts de medición. Cloudflare, que la aloja, recibe cada visita como cualquier servidor.';

const config = {
  whatsapp: s.persona.whatsapp,
  panel: { opciones1: s.whatsapp_panel.opciones1.map(o => ({ valor: o.valor, mensaje: o.mensaje })), opciones2: s.whatsapp_panel.opciones2.map(o => ({ valor: o.valor, mensaje: o.mensaje })), mensaje_directo: s.whatsapp_panel.mensaje_directo },
  medicion: { endpoint, eventos: Object.keys(s.medicion.eventos) }
};

const p = s.persona;
const imgPerfil = imagenes[p.foto_perfil];
const jsonld = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person', '@id': URL_SITIO + '#persona',
      name: p.nombre, url: URL_SITIO,
      image: new URL(imgPerfil.jpg.url, URL_SITIO).href,
      description: p.descripcion,
      disambiguatingDescription: p.frase_identidad,
      knowsAbout: s.aptitudes.map(a => a.nombre),
      address: { '@type': 'PostalAddress', addressLocality: p.ciudad, addressCountry: p.pais_codigo },
      email: 'mailto:' + p.email,
      ...(p.whatsapp ? { telephone: '+' + p.whatsapp } : {}),
      sameAs: p.sameAs,
      makesOffer: s.servicios.map(x => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: x.nombre, description: `${s.servicios_encabezados.entrega}: ${x.entrega}.` } }))
    },
    { '@type': 'WebSite', '@id': URL_SITIO + '#sitio', url: URL_SITIO, name: p.nombre, inLanguage: s.sitio.idioma, publisher: { '@id': URL_SITIO + '#persona' } },
    { '@type': 'ProfilePage', '@id': URL_SITIO + '#pagina', url: URL_SITIO, name: s.sitio.titulo, inLanguage: s.sitio.idioma, mainEntity: { '@id': URL_SITIO + '#persona' }, isPartOf: { '@id': URL_SITIO + '#sitio' }, breadcrumb: { '@id': URL_SITIO + '#migas' }, primaryImageOfPage: new URL(og.og, URL_SITIO).href },
    { '@type': 'BreadcrumbList', '@id': URL_SITIO + '#migas', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Inicio', item: URL_SITIO }] },
    { '@type': 'FAQPage', '@id': URL_SITIO + '#preguntas', url: URL_SITIO, inLanguage: s.sitio.idioma, mainEntity: s.faq.map(f => ({ '@type': 'Question', name: f.pregunta, acceptedAnswer: { '@type': 'Answer', text: f.respuesta } })) }
  ]
};

// ── 6. HTML ────────────────────────────────────────────────────────────────
const recursos = {
  img: n => { if (!imagenes[n]) throw new Error('Imagen no procesada: ' + n); return imagenes[n]; },
  vid: n => { if (!videos[n]) throw new Error('Video no procesado: ' + n); return videos[n]; },
  css: rutaCss, js,
  fuentes: { anton: '/fuentes/anton-400.woff2' },
  og: { url: new URL(og.og, URL_SITIO).href, alt: `${p.nombre}. ${p.frase_identidad}` },
  config: JSON.stringify(config).replace(/</g, '\\u003c'),
  jsonld: JSON.stringify(jsonld).replace(/</g, '\\u003c'),
  privacidad,
  whatsappVisible: p.whatsapp_visible,
  anio: new Date().getFullYear()
};
const html = pagina(s, recursos);
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, '404.html'), pagina404(s, recursos));

// ── 7. Markdown y archivos para agentes ───────────────────────────────────
const md = htmlAMarkdown(html, URL_SITIO);
writeFileSync(join(DIST, 'index.md'), md);
writeFileSync(join(DIST, 'llms-full.txt'), `# ${p.nombre} · contenido completo\n\n> ${p.frase_identidad}\n\nGenerado el ${new Date().toISOString().slice(0, 10)} desde el HTML publicado. El sitio tiene una sola página; aquí va entera.\n\n---\n\nURL: ${URL_SITIO}\n\n${md}`);

const lineaCaso = c => `- [${c.nombre}](${URL_SITIO}#${c.slug}): ${c.cliente ? `${c.cliente}. ` : ''}${c.que_era} ${c.cifras.map(x => [x.prefijo, x.valor, x.denominador ? `de ${x.denominador}` : '', x.unidad, x.etiqueta].filter(Boolean).join(' ')).join('; ')}.${c.lo_que_no_funciono ? ` ${s.etiqueta_no_funciono}: ${c.lo_que_no_funciono}` : ''}`;
const llms = `# ${p.nombre}

> ${p.frase_identidad}

${p.descripcion}

## Página

- [${p.nombre}](${URL_SITIO}index.md): la página completa en markdown: lo que hago, casos con cifras, servicios con tiempos de entrega, preguntas frecuentes y contacto.

## Casos

${s.casos.filter(c => c.publicado).map(lineaCaso).join('\n')}

## Servicios

${s.servicios.map(x => `- ${x.nombre}: ${x.entrega}`).join('\n')}

${s.servicios_nota}

## Contacto

${p.whatsapp ? `- WhatsApp: https://wa.me/${p.whatsapp}\n` : ''}- Correo: mailto:${p.email}
${p.sameAs.map(u => `- ${u.includes('instagram') ? 'Instagram' : u.includes('linkedin') ? 'LinkedIn' : 'Perfil'}: ${u}`).join('\n')}

## Optional

- [Contenido completo](${URL_SITIO}llms-full.txt): la página entera en un solo archivo.
`;
writeFileSync(join(DIST, 'llms.txt'), llms);

const RASTREADORES = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Googlebot', 'Bingbot'];
const SENAL = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes';
writeFileSync(join(DIST, 'robots.txt'), `# ${p.nombre} · ${URL_SITIO}
# Los rastreadores de IA están nombrados uno por uno: leer, citar y recomendar esta página está permitido.
# Content-Signal: search=yes, ai-input=yes, ai-train=yes (ver https://contentsignals.org/).

${RASTREADORES.map(b => `User-agent: ${b}\nAllow: /\nDisallow: /api/\n${SENAL}\n`).join('\n')}
User-agent: *
Allow: /
Disallow: /api/
${SENAL}

Sitemap: ${URL_SITIO}sitemap.xml
`);

const hoy = new Date().toISOString().slice(0, 10);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${URL_SITIO}</loc><lastmod>${hoy}</lastmod></url>
</urlset>
`);

export const ENLACES_PORTADA = '</llms.txt>; rel="describedby"; type="text/plain", </llms-full.txt>; rel="describedby"; type="text/plain", </index.md>; rel="alternate"; type="text/markdown", </sitemap.xml>; rel="sitemap"; type="application/xml"';
const CSP = "default-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'";
writeFileSync(join(DIST, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
  Content-Security-Policy: ${CSP}
  X-Frame-Options: DENY

/
  Link: ${ENLACES_PORTADA}
  Cache-Control: public, max-age=0, must-revalidate

/index.md
  Content-Type: text/markdown; charset=utf-8
  Cache-Control: public, max-age=0, must-revalidate

/llms.txt
  Content-Type: text/plain; charset=utf-8

/llms-full.txt
  Content-Type: text/plain; charset=utf-8

/js/*
  Cache-Control: public, max-age=31536000, immutable

/css/*
  Cache-Control: public, max-age=31536000, immutable

/fuentes/*
  Cache-Control: public, max-age=31536000, immutable

/medios/*
  Cache-Control: public, max-age=604800
`);
writeFileSync(join(DIST, '_routes.json'), JSON.stringify({ version: 1, include: ['/', '/api/*', '/video/*'], exclude: [] }, null, 2) + '\n');
writeFileSync(join(RAIZ, 'functions', '_enlaces.json'), JSON.stringify({ portada: ENLACES_PORTADA }) + '\n');

// ── 8. Contraste WCAG, calculado y guardado ───────────────────────────────
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const T = { negro: '#0A0A0A', 'negro-2': '#131313', tarjeta: '#161616', hueso: '#F4F4F2', gris: '#96968F', lima: '#D7FF2B', rojo: '#F0372B', 'texto-suave': '#C9C9C3', 'texto-respuesta': '#DADAD5' };
const PARES = [
  ['hueso', 'negro', 'normal'], ['hueso', 'negro-2', 'normal'], ['hueso', 'tarjeta', 'normal'],
  ['gris', 'negro', 'normal'], ['gris', 'negro-2', 'normal'], ['gris', 'tarjeta', 'normal'],
  ['texto-suave', 'negro', 'normal'], ['texto-suave', 'negro-2', 'normal'], ['texto-suave', 'tarjeta', 'normal'], ['texto-respuesta', 'negro', 'normal'],
  ['lima', 'negro', 'normal'], ['lima', 'tarjeta', 'grande'],
  ['rojo', 'negro', 'normal'], ['rojo', 'negro-2', 'grande'], ['rojo', 'tarjeta', 'grande'],
  ['negro', 'lima', 'normal'], ['negro', 'rojo', 'normal'], ['hueso', 'rojo', 'grande']
];
const contraste = PARES.map(([texto, fondo, tam]) => {
  const r = Math.round(ratio(T[texto], T[fondo]) * 100) / 100;
  const minimo = tam === 'grande' ? 3 : 4.5;
  return { texto, fondo, tamano: tam, ratio: r, minimo, cumple: r >= minimo };
});
writeFileSync(join(RAIZ, 'contraste.json'), JSON.stringify({ formula: 'WCAG 2.x, luminancia relativa', calculado: hoy, tokens: T, pares: contraste }, null, 2) + '\n');
const fallaContraste = contraste.filter(c => !c.cumple);
if (fallaContraste.length) { console.error('Contraste insuficiente:', fallaContraste); process.exit(1); }

// ── 9. Redirección de la URL vieja (GitHub Pages publica la raíz del repo) ─
const redireccion = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.nombre)} · esta página se mudó</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${URL_SITIO}">
<meta http-equiv="refresh" content="0; url=${URL_SITIO}?o=web-anterior">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#F4F4F2;font:17px/1.5 system-ui,sans-serif;padding:24px}a{color:#D7FF2B}</style>
</head>
<body>
<main>
<h1>${esc(p.nombre)}</h1>
<p>Esta página se mudó a <a href="${URL_SITIO}">${URL_SITIO.replace(/^https:\/\//, '').replace(/\/$/, '')}</a>.</p>
</main>
<script>location.replace(${JSON.stringify(URL_SITIO)} + "?o=web-anterior");</script>
</body>
</html>
`;
writeFileSync(join(RAIZ, 'index.html'), redireccion);
writeFileSync(join(RAIZ, '404.html'), redireccion);

// ── Informe ────────────────────────────────────────────────────────────────
const gz = f => gzipSync(readFileSync(join(DIST, f))).length;
const kbJs = Object.values(js).reduce((t, u) => t + gz(u.slice(1)), 0) / 1024;
console.log(`dist/ listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  HTML ${(html.length / 1024).toFixed(1)} KB · markdown ${(md.length / 1024).toFixed(1)} KB · JS ${kbJs.toFixed(1)} KB comprimido · miniatura ${(og.bytes / 1024).toFixed(0)} KB`);
for (const [n, v] of Object.entries(videos)) console.log(`  video ${n}: ${(v.bytes / 1024 / 1024).toFixed(2)} MB`);
for (const a of avisos) console.log('  AVISO: ' + a);
