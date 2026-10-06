/**
 * HTML ya construido → markdown. Pensado para el marcado de esta plantilla,
 * sin dependencias. Omite navegación, diálogos, scripts, duplicados de la cinta
 * y todo lo que lleve aria-hidden="true" o data-md="omitir".
 */

const VACIOS = new Set(['br', 'img', 'source', 'meta', 'link', 'input', 'hr', 'wbr']);
const BLOQUES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'figcaption', 'tr', 'dt', 'dd', 'legend']);
const SIEMPRE_FUERA = new Set(['script', 'style', 'svg', 'nav', 'dialog', 'template', 'video', 'button', 'head', 'noscript']);

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decodificar = s => s.replace(/&(#x?[0-9a-f]+|[a-z]+|#39);/gi, (m, e) => {
  if (ENTIDADES[e] !== undefined) return ENTIDADES[e];
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return m;
});

function atributos(cadena) {
  const a = {};
  for (const m of cadena.matchAll(/([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) a[m[1].toLowerCase()] = decodificar(m[2] ?? m[3] ?? m[4] ?? '');
  return a;
}

export function htmlAMarkdown(html, base) {
  const absoluta = u => { try { return new URL(u, base).href; } catch { return u; } };
  const cuerpo = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  const lineas = [];
  let buffer = '';
  const pila = [];          // { tag, fuera, href, inicioEnlace }
  let fuera = 0;            // profundidad dentro de algo omitido
  let tabla = null;         // { filas: [[...]], cabecera: bool }
  let fila = null;
  let celda = null;
  let lista = [];           // pila de 'ul' / 'ol'

  const volcar = (prefijo = '') => {
    const texto = buffer.replace(/\s+/g, ' ').trim();
    buffer = '';
    if (texto) lineas.push(prefijo + texto, '');
  };

  for (const m of cuerpo.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)\s*(\/?)>|([^<]+)/g)) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) {           // texto
      if (fuera) continue;
      const t = decodificar(m[5]);
      if (celda) celda.texto += t; else buffer += t;
      continue;
    }
    const cierre = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = cierre ? {} : atributos(m[3] || '');

    if (!cierre) {
      const omitir = SIEMPRE_FUERA.has(tag) || attrs['aria-hidden'] === 'true' || attrs['data-md'] === 'omitir';
      if (VACIOS.has(tag)) {
        if (fuera) continue;
        if (tag === 'br') { if (celda) celda.texto += ' '; else buffer += ' '; }
        if (tag === 'img' && attrs.alt && !omitir) { volcar(); lineas.push(`![${attrs.alt}](${absoluta(attrs.src)})`, ''); }
        continue;
      }
      pila.push({ tag, omitir });
      if (omitir) { fuera++; continue; }
      if (fuera) continue;
      if (tag === 'table') { volcar(); tabla = { filas: [] }; }
      else if (tag === 'tr' && tabla) { fila = []; }
      else if ((tag === 'td' || tag === 'th') && fila) { celda = { texto: '', th: tag === 'th' }; }
      else if (tag === 'ul' || tag === 'ol') { volcar(); lista.push(tag); }
      else if (tag === 'a') { const t = `[`; if (celda) celda.texto += t; else buffer += t; pila[pila.length - 1].href = absoluta(attrs.href || ''); }
      else if (BLOQUES.has(tag) || tag === 'div' || tag === 'section' || tag === 'article' || tag === 'figure' || tag === 'footer' || tag === 'header' || tag === 'main') { volcar(); }
      continue;
    }

    // cierre
    let abierto;
    while (pila.length) { abierto = pila.pop(); if (abierto.tag === tag) break; }
    if (!abierto) continue;
    if (abierto.omitir) { fuera--; continue; }
    if (fuera) continue;
    if (tag === 'a') { const t = `](${abierto.href})`; if (celda) celda.texto += t; else buffer += t; continue; }
    if ((tag === 'td' || tag === 'th') && celda) { fila.push(celda.texto.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')); if (celda.th) tabla.cabecera = true; celda = null; continue; }
    if (tag === 'tr' && tabla && fila) { tabla.filas.push(fila); fila = null; continue; }
    if (tag === 'table' && tabla) {
      const [primera, ...resto] = tabla.filas;
      if (primera) {
        lineas.push('| ' + primera.join(' | ') + ' |', '|' + primera.map(() => '---').join('|') + '|');
        for (const f of resto) lineas.push('| ' + f.join(' | ') + ' |');
        lineas.push('');
      }
      tabla = null; continue;
    }
    if (tag === 'ul' || tag === 'ol') { volcar(); lista.pop(); continue; }
    if (/^h[1-6]$/.test(tag)) { volcar('#'.repeat(Number(tag[1])) + ' '); continue; }
    if (tag === 'li') { volcar(lista[lista.length - 1] === 'ol' ? '1. ' : '- '); continue; }
    if (tag === 'blockquote') { volcar('> '); continue; }
    if (BLOQUES.has(tag) || ['div', 'section', 'article', 'figure', 'footer', 'header', 'main'].includes(tag)) {
      volcar(pila.some(x => x.tag === 'blockquote') ? '> ' : '');
    }
  }
  volcar();

  // Une los ítems de lista consecutivos (sin línea en blanco entre ellos).
  const salida = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (l === '' && /^(- |1\. )/.test(lineas[i - 1] || '') && /^(- |1\. )/.test(lineas[i + 1] || '')) continue;
    salida.push(l);
  }
  return salida.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
