/**
 * Verificador AEO · plantilla portable
 *
 * Recorre el HTML ya construido —no el código fuente— y comprueba los criterios
 * de la capa base. Devuelve código de error si alguno falla, así que se puede
 * poner delante de cada publicación y sirve igual dentro de un año.
 *
 *   node verificar-aeo.mjs ./dist
 *
 * Solo usa módulos de Node, sin dependencias, para que se pueda copiar a
 * cualquier proyecto sin instalar nada.
 *
 * SE AJUSTA EL BLOQUE `CONFIG` Y NADA MÁS. Cada proyecto añade sus propios
 * criterios al final, en `propios`.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { join, relative, extname, sep } from 'node:path';

// ── Configuración ─────────────────────────────────────────────────────────

const CONFIG = {
  /** Rutas que se excluyen a propósito del sitemap y de los buscadores. */
  rutasInternas: ['/404.html'],

  /** Tipos de datos estructurados que este sitio debe declarar. */
  tiposEsperados: ['Person', 'FAQPage', 'BreadcrumbList'],

  /** Rastreadores de IA que robots.txt debe nombrar explícitamente. */
  rastreadores: [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
    'ClaudeBot', 'Claude-SearchBot',
    'PerplexityBot', 'Google-Extended', 'Applebot-Extended'
  ],

  /**
   * Caracteres mínimos para que un párrafo cuente como respuesta directa.
   *
   * Es una heurística, no un estándar: mide longitud porque no puede medir si
   * el párrafo responde de verdad. Ajustar por proyecto. Una web de servicios
   * con páginas largas puede subirlo; un sitio con entradas breves de actividad
   * lo baja. Si hay que bajarlo mucho para que pase, el problema no es el
   * número: son las páginas.
   */
  minimoRespuestaDirecta: 100,

  /** Archivos que deben existir en la raíz del sitio construido. */
  archivosObligatorios: ['robots.txt', 'llms.txt', 'llms-full.txt', '404.html'],

  /** Si el sitio no es de un negocio local, poner en false. */
  negocioLocal: false
};

// ── Andamiaje ─────────────────────────────────────────────────────────────

const RAIZ = process.argv[2] || './dist';
if (!existsSync(RAIZ)) {
  console.error(`No existe la carpeta ${RAIZ}. Construye el sitio primero.`);
  process.exit(1);
}

const resultados = [];
const comprobar = (id, titulo, fn) => {
  try {
    const detalle = fn();
    resultados.push({ id, titulo, ok: true, detalle });
  } catch (err) {
    resultados.push({ id, titulo, ok: false, detalle: err.message });
  }
};
const exigir = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };

/** Recorre recursivamente y devuelve rutas de archivo con una extensión dada. */
function archivos(dir, ext) {
  const salida = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta, ext));
    else if (extname(ruta) === ext) salida.push(ruta);
  }
  return salida;
}

const paginas = archivos(RAIZ, '.html').map(ruta => ({
  ruta,
  url: '/' + relative(RAIZ, ruta).split(sep).join('/').replace(/index\.html$/, ''),
  html: readFileSync(ruta, 'utf8')
}));

const esInterna = url => CONFIG.rutasInternas.some(r => url.startsWith(r));
const publicas = paginas.filter(p => !esInterna(p.url));

const leerRaiz = f => existsSync(join(RAIZ, f)) ? readFileSync(join(RAIZ, f), 'utf8') : null;

/** Quita scripts, estilos y etiquetas para quedarse con el texto visible. */
const soloTexto = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// ── Criterios ─────────────────────────────────────────────────────────────

comprobar('E1', 'Cada página con un único encabezado principal', () => {
  const malas = paginas.filter(p => (p.html.match(/<h1[\s>]/gi) || []).length !== 1);
  exigir(!malas.length, `${malas.length} páginas sin exactamente un H1: ${malas.slice(0, 3).map(p => p.url).join(', ')}`);
  return `${paginas.length} páginas, una H1 cada una.`;
});

comprobar('E2', 'Ninguna imagen sin texto alternativo', () => {
  let total = 0, sinAlt = [];
  for (const p of paginas) {
    for (const img of p.html.match(/<img\b[^>]*>/gi) || []) {
      total++;
      if (!/\balt\s*=/.test(img)) sinAlt.push(p.url);
    }
  }
  exigir(!sinAlt.length, `${sinAlt.length} imágenes sin atributo alt en: ${[...new Set(sinAlt)].slice(0, 3).join(', ')}`);
  return `${total} imágenes revisadas, todas con alt.`;
});

comprobar('E3', 'Sin enlaces internos rotos', () => {
  const existentes = new Set(paginas.map(p => p.url.replace(/\/$/, '') || '/'));
  const rotos = [];
  let total = 0;
  for (const p of paginas) {
    for (const m of p.html.matchAll(/href="(\/[^"#?]*)/g)) {
      const destino = m[1].replace(/\/$/, '') || '/';
      if (/\.[a-z0-9]{2,5}$/i.test(destino)) continue;   // archivos, no páginas
      total++;
      if (!existentes.has(destino)) rotos.push(`${p.url} → ${m[1]}`);
    }
  }
  exigir(!rotos.length, `${rotos.length} enlaces rotos: ${rotos.slice(0, 3).join(' · ')}`);
  return `${total} enlaces internos revisados, ninguno roto.`;
});

comprobar('E4', 'Títulos únicos y descripción propia', () => {
  const titulos = new Map();
  for (const p of paginas) {
    const t = (p.html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim();
    exigir(t, `Sin <title>: ${p.url}`);
    exigir(!titulos.has(t), `Título repetido en ${p.url} y ${titulos.get(t)}: "${t}"`);
    titulos.set(t, p.url);
    exigir(/<meta[^>]+name="description"[^>]+content="[^"]{50,}"/i.test(p.html),
           `Sin descripción útil: ${p.url}`);
  }
  return `${titulos.size} títulos, todos únicos.`;
});

comprobar('E5', 'Todo el contenido en el HTML inicial', () => {
  const flojas = publicas.filter(p => soloTexto(p.html).length < 400);
  exigir(!flojas.length,
    `Páginas casi vacías sin ejecutar JavaScript (${flojas.length}): ${flojas.slice(0, 3).map(p => p.url).join(', ')}`);
  return `Todas las páginas públicas traen su texto sin depender de scripts.`;
});

comprobar('E6', 'Cada página abre con una respuesta directa', () => {
  // Las páginas suelen abrir con un rótulo corto de sección antes del párrafo
  // que de verdad responde. Así que no se exige que el PRIMER párrafo sea
  // sustancial, sino que haya uno sustancial entre los primeros: si la
  // respuesta llega en el sexto párrafo, el asistente ya citó a otro.
  const VENTANA = 3;
  const cortas = [];
  for (const p of publicas.filter(x => !x.url.endsWith('404.html'))) {
    const cuerpo = p.html.split(/<main\b[^>]*>/i)[1] || p.html;
    const parrafos = [...cuerpo.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .slice(0, VENTANA)
      .map(m => soloTexto(m[1]));
    if (!parrafos.some(t => t.length >= CONFIG.minimoRespuestaDirecta)) cortas.push(p.url);
  }
  exigir(!cortas.length,
    `${cortas.length} páginas cuyos primeros ${VENTANA} párrafos no responden nada: ${cortas.slice(0, 3).join(', ')}`);
  return `Todas las páginas públicas responden dentro de los primeros ${VENTANA} párrafos.`;
});

comprobar('E7', 'Archivos de descubrimiento publicados', () => {
  const faltan = CONFIG.archivosObligatorios.filter(f => !existsSync(join(RAIZ, f)));
  exigir(!faltan.length, `Faltan: ${faltan.join(', ')}`);
  return CONFIG.archivosObligatorios.join(', ');
});

comprobar('E8', 'robots.txt nombra a los rastreadores de IA', () => {
  const robots = leerRaiz('robots.txt');
  exigir(robots, 'No hay robots.txt');
  const faltan = CONFIG.rastreadores.filter(r => !robots.includes(r));
  exigir(!faltan.length, `No se nombran: ${faltan.join(', ')}`);
  return `${CONFIG.rastreadores.length} rastreadores nombrados explícitamente.`;
});

comprobar('E9', 'Preferencias de uso declaradas', () => {
  const robots = leerRaiz('robots.txt') || '';
  exigir(/^Content-Signal:/m.test(robots), 'Falta la línea Content-Signal en robots.txt');
  return robots.match(/^Content-Signal:.*/m)[0];
});

comprobar('E10', 'Datos estructurados válidos', () => {
  const tipos = new Set();
  for (const p of paginas) {
    for (const m of p.html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      let datos;
      try { datos = JSON.parse(m[1]); }
      catch { throw new Error(`JSON-LD que no parsea en ${p.url}`); }
      for (const nodo of [].concat(datos['@graph'] || datos)) {
        if (nodo && nodo['@type']) [].concat(nodo['@type']).forEach(t => tipos.add(t));
      }
    }
  }
  const faltan = CONFIG.tiposEsperados.filter(t => !tipos.has(t));
  exigir(!faltan.length, `Faltan tipos: ${faltan.join(', ')}. Presentes: ${[...tipos].join(', ')}`);
  return `Tipos presentes: ${[...tipos].sort().join(', ')}`;
});

comprobar('E11', 'El sitemap deja fuera las rutas internas', () => {
  const sitemap = archivos(RAIZ, '.xml').map(f => readFileSync(f, 'utf8')).join('');
  exigir(sitemap, 'No se encontró ningún sitemap');
  const coladas = CONFIG.rutasInternas.filter(r => sitemap.includes(r));
  exigir(!coladas.length, `Rutas internas dentro del sitemap: ${coladas.join(', ')}`);
  return 'Sitemap limpio.';
});

comprobar('E12', 'Las rutas internas llevan noindex', () => {
  const sinNoindex = paginas.filter(p => esInterna(p.url) && !/noindex/i.test(p.html));
  exigir(!sinNoindex.length, `Sin noindex: ${sinNoindex.map(p => p.url).join(', ')}`);
  return `${paginas.length - publicas.length} rutas internas, todas con noindex.`;
});

comprobar('E13', 'Ninguna imagen servida conserva metadatos', () => {
  const imagenes = ['.jpg', '.jpeg', '.png', '.webp', '.avif'].flatMap(e => archivos(RAIZ, e));
  const conExif = imagenes.filter(f => {
    const cabecera = readFileSync(f).subarray(0, 65536).toString('latin1');
    return cabecera.includes('Exif\0') || cabecera.includes('http://ns.adobe.com/xap');
  });
  exigir(!conExif.length, `${conExif.length} imágenes con metadatos: ${conExif.slice(0, 3).map(f => relative(RAIZ, f)).join(', ')}`);
  return `${imagenes.length} imágenes revisadas, ninguna con EXIF ni XMP.`;
});

comprobar('E14', 'Open Graph en todas las páginas', () => {
  const malas = paginas.filter(p => !/property="og:title"/i.test(p.html));
  exigir(!malas.length, `${malas.length} páginas sin Open Graph`);
  return `${paginas.length} páginas con Open Graph.`;
});

// Páginas que se indexan y se comparten: las públicas sin noindex (la 404 y los laboratorios no cuentan).
const indexables = () => publicas.filter(p => !/<meta name="robots" content="[^"]*noindex/i.test(p.html));

// WhatsApp, Facebook e iMessage arman la vista previa con og:image: URL completa, que exista, 1200 × 630,
// JPG o PNG de menos de 300 KB (más que eso y WhatsApp no la muestra). Aprendido en 365 Restoration, oct 2026.
comprobar('E15', 'Miniatura para compartir el enlace', () => {
  const vistas = new Map();
  for (const p of indexables()) {
    const u = (/<meta property="og:image" content="([^"]+)"/.exec(p.html) || [])[1];
    exigir(u, `${p.url} sin og:image`);
    exigir(/^https:\/\//.test(u), `${p.url}: og:image no es una URL completa (${u})`);
    exigir(/<meta name="twitter:card" content="summary_large_image">/.test(p.html), `${p.url} sin twitter:card`);
    vistas.set(new URL(u).pathname, u);
  }
  for (const [ruta] of vistas) {
    const f = join(RAIZ, ruta);
    exigir(existsSync(f), `og:image apunta a ${ruta} y ese archivo no está en el sitio`);
    const b = readFileSync(f);
    const kb = Math.round(b.length / 1024);
    exigir(kb < 300, `${ruta} pesa ${kb} KB: WhatsApp no muestra imágenes tan pesadas`);
    let w = 0, h = 0;
    if (b[0] === 0x89) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    else for (let i = 2; i < b.length - 9; ) {                    // JPG: busca el marco SOF
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    exigir(w === 1200 && h === 630, `${ruta} mide ${w} × ${h}; tiene que ser 1200 × 630`);
  }
  const origenes = [...new Set([...vistas.values()].map(u => new URL(u).origin))];
  return `${indexables().length} páginas con miniatura; ${vistas.size} imágenes de 1200 × 630, servidas desde ${origenes.join(', ')}.`;
});

// Cada página tiene su versión markdown (<ruta>/index.md, anunciada con <link rel="alternate" type="text/markdown">)
// y llms-full.txt trae todas las del sitemap. Se generan del HTML construido; si una plantilla cambia y el
// markdown pierde el título de la página, falla aquí.
comprobar('E16', 'Cada página en markdown para los agentes', () => {
  const plano = s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const sinEspacios = s => s.replace(/[\s*]/g, '');
  let total = 0;
  for (const p of indexables()) {
    const href = (/<link rel="alternate" type="text\/markdown" href="([^"]+)">/.exec(p.html) || [])[1];
    exigir(href, `${p.url} no anuncia su versión markdown`);
    const f = join(RAIZ, href);
    exigir(existsSync(f), `${p.url}: ${href} no existe`);
    const md = readFileSync(f, 'utf8');
    total += md.length;
    exigir(!/<\/?[a-z][a-z0-9]*[\s>]/i.test(md), `${href} tiene HTML suelto`);
    const h1 = plano((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(p.html) || [])[1] || '');
    exigir(md.split('\n').some(l => l.startsWith('# ') && sinEspacios(l.slice(2)) === sinEspacios(h1)), `${href} no trae el h1 de la página ("${h1}")`);
    exigir(md.length > 400, `${href} tiene ${md.length} caracteres: le falta contenido`);
  }
  const full = leerRaiz('llms-full.txt') || '';
  const urls = [...(leerRaiz('sitemap.xml') || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const faltan = urls.filter(u => !full.includes('URL: ' + u));
  exigir(!faltan.length, `llms-full.txt no trae ${faltan.length} páginas del sitemap: ${faltan.slice(0, 3).join(', ')}`);
  return `${indexables().length} páginas en markdown (${Math.round(total / 1024)} KB); llms-full.txt con las ${urls.length} del sitemap.`;
});

if (CONFIG.negocioLocal) {
  comprobar('L1', 'Datos estructurados de negocio local', () => {
    const portada = paginas.find(p => p.url === '/');
    exigir(portada && /"@type":\s*"[^"]*LocalBusiness/i.test(portada.html) ||
           /"@type":\s*"[^"]*(Plumber|RoofingContractor|HomeAndConstructionBusiness|ProfessionalService)/i.test(portada?.html || ''),
      'La portada no declara LocalBusiness ni un subtipo');
    return 'Negocio local declarado.';
  });

  comprobar('L2', 'El teléfono aparece en todas las páginas', () => {
    const malas = paginas.filter(p => !/href="tel:/i.test(p.html));
    exigir(!malas.length, `${malas.length} páginas sin enlace de teléfono`);
    return `${paginas.length} páginas con teléfono enlazado.`;
  });

  comprobar('L3', 'Perfiles externos declarados en sameAs', () => {
    const portada = paginas.find(p => p.url === '/');
    exigir(/"sameAs"\s*:\s*\[[^\]]*https?:/i.test(portada?.html || ''),
      'sameAs vacío o ausente: la identidad no está cosida a ninguna fuente externa');
    return 'sameAs poblado.';
  });
}

// ── Criterios propios del proyecto ────────────────────────────────────────
// Salen de 04-SPEC-LANDING.md, sección 5. Lo que necesita un navegador real
// (panel, foco, sin JS, movimiento reducido, scroll horizontal) va en
// scripts/pruebas-navegador.mjs.

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITIO = JSON.parse(readFileSync(join(WEB, 'datos', 'sitio.json'), 'utf8'));
const portada = paginas.find(p => p.url === '/');
const textoPortada = soloTexto(portada.html.split(/<body[^>]*>/i)[1]);
const archivosTexto = ['.html', '.md', '.txt', '.xml'].flatMap(e => archivos(RAIZ, e));
const jsonld = JSON.parse((portada.html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1] || '{}');
const nodos = [].concat(jsonld['@graph'] || jsonld);
const persona = nodos.find(n => n['@type'] === 'Person') || {};
const sha = b => createHash('sha256').update(b).digest('hex');
// Quita etiquetas sin meter espacios: «Ell<span>i</span>gon» sigue siendo una palabra.
const sinEtiquetas = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

comprobar('P1', 'Toda cifra de la página sale de sitio.json', () => {
  const fuente = JSON.stringify(SITIO);
  const anio = String(new Date().getFullYear());
  const numeros = [...new Set(textoPortada.match(/\d+(?:[.,]\d+)*/g) || [])];
  const huerfanos = numeros.filter(n => n !== anio && !fuente.includes(n));
  exigir(!huerfanos.length, `Cifras que no están en sitio.json: ${huerfanos.join(', ')}`);
  const sinFuente = SITIO.casos.flatMap(c => c.cifras.filter(x => !x.fuente).map(x => `${c.slug}: ${x.valor}`));
  exigir(!sinFuente.length, `Cifras sin fuente: ${sinFuente.join(', ')}`);
  return `${numeros.length} cifras distintas en la página, todas en sitio.json; ${SITIO.casos.flatMap(c => c.cifras).length} cifras de casos con fuente.`;
});

comprobar('P2', 'No aparece lo que salió de la web', () => {
  const VETADO = [/practi\s*pack/i, /sachet/i, /Arquitecto Estrat[ée]gico de Sistemas de Innovaci[óo]n Comercial/i, /Fractional Head of Innovation/i, /\bagencia\b/i];
  const hallazgos = [];
  for (const f of archivosTexto) {
    const t = readFileSync(f, 'utf8');
    for (const re of VETADO) if (re.test(t)) hallazgos.push(`${relative(RAIZ, f)}: ${re}`);
  }
  exigir(!hallazgos.length, hallazgos.join(' · '));
  return `${archivosTexto.length} archivos de texto revisados: sin el proyecto cerrado, sin el título viejo, sin «agencia».`;
});

comprobar('P3', 'Medios solo de la lista cerrada y nada de _to_delete', () => {
  const manifiesto = JSON.parse(readFileSync(join(WEB, 'medios', 'manifiesto.json'), 'utf8'));
  const permitidos = new Map(manifiesto.map(m => [m.archivo.replace(/\.[a-z0-9]+$/i, ''), m]));
  const excluidosDir = join(WEB, '..', '_to_delete');
  const hashExcluidos = new Set(['46d98390babe5f158b633db5cee6ead45e9765a85c57cc27499245c4c1334db0']);
  const nombresExcluidos = existsSync(excluidosDir) ? readdirSync(excluidosDir).map(n => n.replace(/\.[a-z0-9]+$/i, '')) : [];
  if (existsSync(excluidosDir)) for (const n of readdirSync(excluidosDir)) hashExcluidos.add(sha(readFileSync(join(excluidosDir, n))));
  const servidos = readdirSync(join(RAIZ, 'medios'));
  const malos = [];
  for (const f of servidos) {
    const base = f.replace(/-\d+\.(webp|jpg)$/i, '').replace(/\.(mp4)$/i, '');
    if (!permitidos.has(base)) malos.push(`${f} no viene de la lista cerrada`);
    if (nombresExcluidos.includes(base)) malos.push(`${f} es de _to_delete`);
  }
  const assets = join(WEB, '..', 'assets');
  for (const m of manifiesto) {
    if (hashExcluidos.has(m.sha256_fuente)) malos.push(`${m.archivo} coincide con una foto excluida`);
    if (existsSync(assets)) {
      const original = join(assets, m.archivo);
      if (!existsSync(original)) malos.push(`${m.archivo} ya no está en assets/`);
      else if (sha(readFileSync(original)) !== m.sha256_fuente) malos.push(`${m.archivo} cambió en assets/: correr npm run medios`);
    }
  }
  exigir(!malos.length, malos.slice(0, 5).join(' · '));
  return `${servidos.length} archivos servidos, de ${manifiesto.length} originales de assets/; ninguno excluido.`;
});

comprobar('P4', 'La frase de identidad es idéntica en todas partes', () => {
  const frase = SITIO.persona.frase_identidad;
  const enPortada = soloTexto((portada.html.match(/<p class="portada__frase">([\s\S]*?)<\/p>/) || [])[1] || '');
  const enLlms = ((leerRaiz('llms.txt') || '').match(/^> (.*)$/m) || [])[1];
  exigir(enPortada === frase, `Portada: «${enPortada}»`);
  exigir(persona.disambiguatingDescription === frase, `JSON-LD: «${persona.disambiguatingDescription}»`);
  exigir(enLlms === frase, `llms.txt: «${enLlms}»`);
  exigir(persona.description === SITIO.persona.descripcion, 'La descripción del JSON-LD no es el párrafo de respuesta directa');
  exigir(portada.html.includes(`<meta name="description" content="${SITIO.persona.descripcion}">`), 'La meta description no es el párrafo de respuesta directa');
  return `«${frase}» en portada, JSON-LD y llms.txt.`;
});

comprobar('P5', 'Lista negra de estilo (estilo-anti-ia.md)', () => {
  const NEGRA = ['en el mundo actual', 'en la era digital', 'hoy en día', 'es importante destacar', 'sumergir', 'revolucionari', 'potenciar', 'sin duda', 'desbloque', 'siguiente nivel', 'opcional', 'si quieres'];
  const md = (leerRaiz('index.md') || '').toLowerCase();
  const texto = textoPortada.toLowerCase() + ' ' + md;
  const hallados = NEGRA.filter(f => texto.includes(f));
  const reencuadre = texto.match(/\bno es [^.;:]{1,60}, (?:es|sino) /);
  exigir(!hallados.length, `Frases prohibidas: ${hallados.join(', ')}`);
  exigir(!reencuadre, `Reencuadre «no es X, es Y»: «${reencuadre && reencuadre[0]}»`);
  return `${NEGRA.length} frases y el reencuadre «no es X, es Y» buscados: ninguno. La revisión fina es manual.`;
});

comprobar('P6', 'Enlaces de WhatsApp bien formados', () => {
  const hrefs = [...portada.html.matchAll(/href="(https:\/\/wa\.me\/[^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  if (!SITIO.persona.whatsapp) { exigir(!hrefs.length, 'WhatsApp en null pero hay enlaces a wa.me'); return 'WhatsApp en null: ningún botón pintado.'; }
  const malos = hrefs.filter(h => {
    const m = /^https:\/\/wa\.me\/(\d{8,15})\?text=(\S+)$/.exec(h);
    if (!m || m[1] !== SITIO.persona.whatsapp) return true;
    try { return !decodeURIComponent(m[2]).startsWith('Hola Geiser'); } catch { return true; }
  });
  exigir(!malos.length, `Mal formados: ${malos.slice(0, 2).join(' · ')}`);
  return `${hrefs.length} enlaces a wa.me/${SITIO.persona.whatsapp}, todos con texto codificado.`;
});

comprobar('P7', 'Correo correcto', () => {
  const mails = [...portada.html.matchAll(/href="(mailto:[^"]*)"/g)].map(m => m[1]);
  exigir(mails.length && mails.every(m => m === 'mailto:' + SITIO.persona.email), `mailto: ${mails.join(', ')}`);
  return mails[0];
});

comprobar('P8', 'Videos livianos, silenciosos y con póster', () => {
  const videos = portada.html.match(/<video\b[^>]*>/g) || [];
  for (const v of videos) {
    for (const a of ['muted', 'playsinline', 'loop', 'preload="none"', 'poster="', 'data-src="']) exigir(v.includes(a), `Video sin ${a}: ${v.slice(0, 90)}`);
    exigir(!/\ssrc=/.test(v), 'Un video trae src en el HTML: se descargaría antes de load');
  }
  const mp4 = archivos(RAIZ, '.mp4');
  const pesados = mp4.filter(f => statSync(f).size > 3.5 * 1024 * 1024);
  exigir(!pesados.length, `Más de 3,5 MB: ${pesados.map(f => relative(RAIZ, f)).join(', ')}`);
  return `${videos.length} videos; ${mp4.map(f => `${relative(RAIZ, f)} ${(statSync(f).size / 1048576).toFixed(2)} MB`).join(', ')}.`;
});

comprobar('P9', 'Texto alternativo real en cada imagen', () => {
  const malos = [];
  let total = 0;
  const html = portada.html.replace(/<div class="portada__medio" aria-hidden="true">[\s\S]*?<\/div>\s*<div class="portada__mascara">/, '');
  for (const img of html.match(/<img\b[^>]*>/g) || []) {
    total++;
    const alt = (/\balt="([^"]*)"/.exec(img) || [])[1];
    const src = (/\bsrc="([^"]*)"/.exec(img) || [])[1] || '';
    if (!alt) malos.push(`sin alt: ${src}`);
    else if (/\.(jpe?g|png|webp)\b/i.test(alt) || alt.length < 12) malos.push(`alt pobre: «${alt}»`);
  }
  exigir(!malos.length, malos.slice(0, 3).join(' · '));
  return `${total} imágenes con contenido, todas describen la escena; el póster de la portada es decorativo (aria-hidden).`;
});

comprobar('P10', 'Presupuesto de JavaScript y nada de terceros', () => {
  const scripts = [...portada.html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
  const externos = [...portada.html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]).filter(u => !u.startsWith(SITIO.sitio.url));
  exigir(!externos.length, `Recursos de terceros: ${externos.join(', ')}`);
  const kb = scripts.reduce((t, s) => t + gzipSync(readFileSync(join(RAIZ, s))).length, 0) / 1024;
  exigir(kb < 70, `${kb.toFixed(1)} KB comprimidos: pasa de 70`);
  exigir(scripts.every(s => new RegExp(`<script src="${s}" defer>`).test(portada.html)), 'Algún script no lleva defer');
  return `${scripts.length} scripts propios con defer, ${kb.toFixed(1)} KB comprimidos de 70; sin terceros.`;
});

comprobar('P11', 'Contraste calculado y guardado', () => {
  const c = JSON.parse(readFileSync(join(WEB, 'contraste.json'), 'utf8'));
  const malos = c.pares.filter(p => !p.cumple);
  exigir(!malos.length, malos.map(p => `${p.texto}/${p.fondo} ${p.ratio}`).join(', '));
  return `${c.pares.length} pares con la fórmula WCAG, todos cumplen (hueso/negro ${c.pares[0].ratio}:1).`;
});

comprobar('P12', 'La nota de privacidad dice exactamente lo que se mide', () => {
  const nota = soloTexto((portada.html.match(/<div class="pie__privacidad"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '');
  const config = JSON.parse((portada.html.match(/<script type="application\/json" id="config-sitio">([\s\S]*?)<\/script>/) || [])[1]);
  const declarados = Object.keys(SITIO.medicion.eventos);
  exigir(JSON.stringify(config.medicion.eventos) === JSON.stringify(declarados), 'La página mide eventos distintos de los declarados');
  const faltan = Object.values(SITIO.medicion.eventos).filter(d => !nota.includes(d.replace(/«|»/g, m => m)));
  exigir(!faltan.length, `La nota no menciona: ${faltan.join(' | ')}`);
  const app = readFileSync(join(RAIZ, (portada.html.match(/<script src="(\/js\/app\.[^"]+)"/) || [])[1]), 'utf8');
  const usados = [...app.matchAll(/medir\('([a-z_]+)'/g)].map(m => m[1]);
  const fuera = usados.filter(u => !declarados.includes(u));
  exigir(!fuera.length, `app.js mide algo no declarado: ${fuera.join(', ')}`);
  exigir(/no usa cookies/.test(nota), 'La nota no dice que no hay cookies');
  return `${declarados.length} eventos declarados, los mismos en la nota, en app.js y en la Function.`;
});

comprobar('P13', 'Rutas preparadas apagadas y reseñas apagadas', () => {
  for (const r of ['hyrox', 'en', 'casos']) exigir(!existsSync(join(RAIZ, r)), `/${r} existe y en V2 va apagada`);
  exigir(!nodos.some(n => /Rating|Review/.test(String(n['@type']))) && !/AggregateRating|"Review"/.test(portada.html), 'Hay datos de reseñas');
  return '/hyrox, /en y /casos sin publicar; sin datos de reseñas.';
});

comprobar('P14', 'El H1 es el nombre y la identidad está cosida', () => {
  const h1 = sinEtiquetas((portada.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  exigir(h1 === SITIO.persona.nombre, `H1: «${h1}»`);
  exigir(Array.isArray(persona.sameAs) && persona.sameAs.length && persona.sameAs.every(u => /^https:\/\//.test(u) && !/[?&]utm_/.test(u)), 'sameAs vacío, sin https o con parámetros de seguimiento');
  exigir(portada.html.includes(`<link rel="canonical" href="${SITIO.sitio.url}">`), 'canonical distinto de la URL del sitio');
  exigir(!/name="robots"[^>]*noindex/.test(portada.html), 'La portada lleva noindex');
  return `H1 «${h1}»; sameAs: ${persona.sameAs.join(', ')}.`;
});

comprobar('P15', 'llms-full.txt trae la página entera', () => {
  const md = leerRaiz('index.md');
  const full = leerRaiz('llms-full.txt');
  const plano = s => s.replace(/\s+/g, ' ').trim();
  const bloques = md.split(/\n{2,}/).map(plano).filter(Boolean);
  const faltan = bloques.filter(b => !plano(full).includes(b));
  exigir(!faltan.length, `${faltan.length} bloques de index.md no están en llms-full.txt`);
  const main = portada.html.split('<main')[1].split('</main>')[0];
  const parrafos = [...main.matchAll(/<p class="(?!cinta)[^"]*">([\s\S]*?)<\/p>/g)].map(m => plano(sinEtiquetas(m[1]))).filter(t => t.length > 30);
  const fuera = parrafos.filter(p => !plano(md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).includes(p));
  exigir(!fuera.length, `Párrafos de la página que faltan en el markdown: ${fuera.slice(0, 2).join(' | ')}`);
  return `${bloques.length} bloques del markdown en llms-full.txt (${Math.round(full.length / 1024)} KB); ${parrafos.length} párrafos de la página presentes.`;
});

comprobar('P16', 'Cabecera Link en la portada', () => {
  const cab = leerRaiz('_headers') || '';
  const bloque = (cab.match(/^\/\n((?:\s+.*\n)+)/m) || [])[1] || '';
  exigir(/Link: .*rel="describedby"/.test(bloque), '_headers no pone Link con describedby en /');
  const enMiddleware = JSON.parse(readFileSync(join(WEB, 'functions', '_enlaces.json'), 'utf8')).portada;
  exigir(bloque.includes(enMiddleware), 'El Link del middleware y el de _headers no coinciden');
  return 'Link a llms.txt, llms-full.txt, index.md y sitemap.xml, igual en _headers y en el middleware.';
});

// ── Informe ───────────────────────────────────────────────────────────────

const ancho = 78;
console.log('\n' + '='.repeat(ancho));
console.log('VERIFICACIÓN AEO · ' + new Date().toLocaleString('es-ES'));
console.log('='.repeat(ancho) + '\n');

for (const r of resultados) {
  console.log(`[${r.ok ? 'OK' : ' X'}] ${r.id.padEnd(4)} ${r.titulo}`);
  console.log(`       ${r.detalle}\n`);
}

const fallos = resultados.filter(r => !r.ok).length;
console.log('='.repeat(ancho));
console.log(`RESULTADO: ${resultados.length - fallos} de ${resultados.length} criterios aprobados.`);

if (fallos) {
  console.log('\nNo se publica hasta que estén los ' + resultados.length + '.');
  process.exit(1);
}

console.log(`
Lo que este script NO puede comprobar y hay que hacer a mano:
  - Pasar la URL por ChatGPT, Claude y Perplexity: ¿qué entienden que hace
    este negocio y dónde opera?
  - isitagentready.com: guardar el desglose, no el número.
  - Que la frase descriptiva sea idéntica en todas las fuentes externas.
  - Que el NAP coincida con la ficha de negocio y los directorios.
`);
