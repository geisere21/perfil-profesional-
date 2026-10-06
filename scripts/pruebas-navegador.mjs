/**
 * Pruebas en Chrome real (puppeteer-core) contra el sitio servido.
 * Los 5 casos de verify-after-changes, sacados de 04-SPEC-LANDING.md §5.
 * Los textos esperados están copiados del spec a propósito: así la prueba
 * también comprueba que sitio.json dice lo que el spec pide.
 *
 *   node scripts/pruebas-navegador.mjs [url]       (por defecto http://localhost:8098/)
 *   --en-vivo   omite las pruebas que escriben en la base (para la URL publicada)
 */
import puppeteer from 'puppeteer-core';
import { CHROME, PUERTO_LOCAL } from './config.mjs';

const args = process.argv.slice(2);
const EN_VIVO = args.includes('--en-vivo');
const BASE = (args.find(a => !a.startsWith('--')) || `http://localhost:${PUERTO_LOCAL}/`).replace(/\/?$/, '/');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 PruebaGeiser';
const espera = ms => new Promise(r => setTimeout(r, ms));
// En vivo, las páginas se identifican como automáticas: la Function no guarda sus eventos.
const UA_PAGINA = EN_VIVO ? UA + ' HeadlessChrome' : UA;

// ── Del spec, sección 4, «Panel de WhatsApp» ─────────────────────────────
const NUMERO = '584142533279';
const P1 = {
  producto: 'Hola Geiser, vengo de tu web. Quiero poner en marcha un producto o un lanzamiento.',
  preventa: 'Hola Geiser, vengo de tu web. Quiero armar una preventa o un registro con cupos.',
  digital: 'Hola Geiser, vengo de tu web. Me interesa una web, una app o un sistema de captación.',
  definiendo: 'Hola Geiser, vengo de tu web. Tengo una idea que todavía estoy definiendo y quiero conversarla.'
};
const P2 = {
  este_mes: 'Me gustaría arrancar este mes. Mi marca o negocio es: ',
  uno_a_tres: 'Me gustaría arrancar en uno a tres meses. Mi marca o negocio es: ',
  sin_fecha: 'Todavía no tengo fecha. Mi marca o negocio es: '
};
const DIRECTO = 'Hola Geiser, vengo de tu web.';
const SERVICIO_Q1 = { 'llenar-una-fecha': 'preventa', 'sistema-de-captacion': 'preventa', 'sitio-multipagina': 'digital', 'plataforma-de-datos': 'digital', 'producto-y-formato': 'producto', diagnostico: 'definiendo' };
const CAMPOS_PERMITIDOS = new Set(['tipo', 'origen', 'boton', 'q1', 'q2']);

const resultados = [];
const caso = (n, titulo) => { const r = { n, titulo, detalles: [], fallos: [] }; resultados.push(r); return r; };
const textoWa = href => { const u = new URL(href); return u.host === 'api.whatsapp.com' ? { numero: u.searchParams.get('phone'), texto: u.searchParams.get('text') } : { numero: u.pathname.slice(1), texto: u.searchParams.get('text') }; };
const esWa = u => /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(u);

const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 45000, args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
// WhatsApp se abre en pestaña nueva: se anota su URL y se cierra, para que la página probada no quede en segundo plano.
const pestanas = [];
navegador.on('targetcreated', async t => {
  if (t.type() !== 'page' || !t.opener()) return;
  pestanas.push(t.url());
  try { const np = await t.page(); setTimeout(() => np && np.close().catch(() => {}), 400); } catch { /* ya cerrada */ }
});
navegador.on('targetchanged', t => { if (t.opener()) pestanas.push(t.url()); });

async function pagina({ ancho = 1440, alto = 900, js = true, quieto = false, saveData = false, url = BASE, referer, interceptarWa = true } = {}) {
  const p = await navegador.newPage();
  await p.setUserAgent(UA_PAGINA);
  const movil = ancho < 820;
  await p.setViewport({ width: ancho, height: alto, isMobile: movil, hasTouch: movil, deviceScaleFactor: 1 });
  if (!js) await p.setJavaScriptEnabled(false);
  if (quieto) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  // En local (http) Chrome borra la referencia que viene de https; se simula document.referrer. En vivo va la real.
  if (referer && BASE.startsWith('http://')) await p.evaluateOnNewDocument(r => Object.defineProperty(Document.prototype, 'referrer', { get: () => r }), referer);
  if (saveData) await p.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' } }));
  const red = { eventos: [], externos: [], wa: [], mp4: [], errores: [] };
  await p.setRequestInterception(true);
  p.on('popup', np => { if (np) { pestanas.push(np.url()); np.close().catch(() => {}); } });
  p.on('request', async r => {
    const u = r.url();
    if (u.includes('/api/evento')) {
      // sendBeacon manda un Blob: postData() viene vacío y hay que pedirlo.
      let cuerpo = r.postData();
      if (!cuerpo && r.hasPostData()) cuerpo = await r.fetchPostData().catch(() => null);
      try { red.eventos.push(JSON.parse(cuerpo || '{}')); } catch { red.eventos.push({ crudo: cuerpo }); }
    }
    if (u.includes('.mp4')) red.mp4.push({ u, t: Date.now() });
    if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(u)) { red.wa.push(u); if (interceptarWa) return r.abort(); }
    else if (!u.startsWith(new URL(BASE).origin) && !u.startsWith('data:')) red.externos.push(u);
    r.continue();
  });
  p.on('pageerror', e => red.errores.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) red.errores.push(m.text()); });
  await p.goto(url, { waitUntil: 'networkidle0', referer });
  await espera(600);
  return { p, red };
}

// ── Caso 1 · Panel de WhatsApp ───────────────────────────────────────────
{
  const c = caso(1, 'Camino feliz P0: el panel de WhatsApp arma el mensaje exacto');
  const { p, red } = await pagina();
  let combinaciones = 0;
  for (const [q1, t1] of Object.entries(P1)) for (const [q2, t2] of Object.entries(P2)) {
    await p.click('.portada__acciones a[data-wa]');
    await p.waitForSelector('#panel-wa[open]', { timeout: 3000 });
    const antes = await p.$eval('#panel-wa-abrir', a => a.getAttribute('aria-disabled'));
    if (antes !== 'true') c.fallos.push('«Abrir WhatsApp» activo sin respuestas');
    await p.click(`#panel-wa input[name="q1"][value="${q1}"] + span`);
    const aMedias = await p.$eval('#panel-wa-abrir', a => a.getAttribute('aria-disabled'));
    if (aMedias !== 'true') c.fallos.push('«Abrir WhatsApp» activo con una sola respuesta');
    await p.click(`#panel-wa input[name="q2"][value="${q2}"] + span`);
    const href = await p.$eval('#panel-wa-abrir', a => a.href);
    const { numero, texto } = textoWa(href);
    if (numero !== NUMERO || texto !== `${t1} ${t2}`) c.fallos.push(`${q1}+${q2}: «${texto}»`);
    else combinaciones++;
    if (!/%20$/.test(href)) c.fallos.push(`${q1}+${q2}: el mensaje no termina abierto en «es: »`);
    await p.click('#panel-wa-abrir');
    await espera(250);
    await p.bringToFront();
    if (await p.$('#panel-wa[open]')) { c.fallos.push('El panel no se cerró al abrir WhatsApp'); await p.keyboard.press('Escape'); }
  }
  c.detalles.push(`${combinaciones} de 12 combinaciones con el texto exacto del spec, tildes incluidas.`);

  // Directo
  await p.click('.portada__acciones a[data-wa]');
  await p.waitForSelector('#panel-wa[open]');
  const directo = textoWa(await p.$eval('#panel-wa-directo', a => a.href)).texto;
  if (directo !== DIRECTO) c.fallos.push(`Directo: «${directo}»`); else c.detalles.push('«Prefiero escribir directo» abre con «Hola Geiser, vengo de tu web.».');
  await p.keyboard.press('Escape');

  // Servicios: pregunta 1 marcada
  let servicios = 0;
  for (const [slug, q1] of Object.entries(SERVICIO_Q1)) {
    const sel = `a[data-wa="servicio-${slug}"]`;
    await p.$eval(sel, a => a.scrollIntoView({ block: 'center' }));
    await espera(150);
    await p.$eval(sel, a => a.click());
    await p.waitForSelector('#panel-wa[open]');
    const marcada = await p.$eval('#panel-wa', d => (d.querySelector('input[name="q1"]:checked') || {}).value || null);
    const q2Vacia = await p.$eval('#panel-wa', d => !d.querySelector('input[name="q2"]:checked'));
    if (marcada !== q1 || !q2Vacia) c.fallos.push(`Servicio ${slug}: q1=${marcada}`); else servicios++;
    await p.keyboard.press('Escape');
    await espera(100);
  }
  c.detalles.push(`${servicios} de 6 filas de Servicios llegan con la pregunta 1 marcada según el spec.`);

  // Escape, foco que no se escapa y vuelve al botón de origen
  await p.$eval('.nav a[data-wa]', a => a.focus());
  await p.keyboard.press('Enter');
  await p.waitForSelector('#panel-wa[open]');
  let fuera = 0;
  for (let i = 0; i < 14; i++) { await p.keyboard.press('Tab'); if (!(await p.evaluate(() => document.getElementById('panel-wa').contains(document.activeElement)))) fuera++; }
  for (let i = 0; i < 6; i++) { await p.keyboard.down('Shift'); await p.keyboard.press('Tab'); await p.keyboard.up('Shift'); if (!(await p.evaluate(() => document.getElementById('panel-wa').contains(document.activeElement)))) fuera++; }
  await p.keyboard.press('Escape');
  await espera(150);
  const cerrado = !(await p.$('#panel-wa[open]'));
  const volvio = await p.evaluate(() => document.activeElement && document.activeElement.matches('.nav a[data-wa]'));
  if (fuera) c.fallos.push(`El foco salió del panel ${fuera} veces`);
  if (!cerrado) c.fallos.push('Escape no cierra');
  if (!volvio) c.fallos.push('El foco no volvió al botón que abrió el panel');
  c.detalles.push(`Teclado: 20 tabulaciones dentro del panel sin salir; Escape cierra; el foco vuelve al botón de la navegación.`);

  // Tocar fuera
  await p.evaluate(() => window.scrollTo(0, 0));
  await espera(700);
  await p.click('.portada__acciones a[data-wa]');
  await p.waitForSelector('#panel-wa[open]');
  await p.mouse.click(5, 5);
  await espera(150);
  if (await p.$('#panel-wa[open]')) c.fallos.push('Tocar fuera no cierra'); else c.detalles.push('Tocar fuera del panel lo cierra.');
  if (red.errores.length) c.fallos.push('Errores de consola: ' + red.errores.join(' | '));
  await p.close();

  // En el teléfono sube desde abajo
  const m = await pagina({ ancho: 390, alto: 844 });
  await m.p.evaluate(() => window.scrollTo(0, 3000));
  await espera(500);
  await m.p.click('.barra-wa a[data-wa]');
  await m.p.waitForSelector('#panel-wa[open]');
  await espera(500);
  const caja = await m.p.$eval('#panel-wa', d => { const r = d.getBoundingClientRect(); return { abajo: Math.round(r.bottom), ancho: Math.round(r.width) }; });
  if (Math.abs(caja.abajo - 844) > 2 || caja.ancho !== 390) c.fallos.push(`En el teléfono el panel no está abajo a todo el ancho: ${JSON.stringify(caja)}`);
  else c.detalles.push('En el teléfono (390 px) el panel sube desde abajo y ocupa el ancho.');
  await m.p.close();
}

// ── Caso 2 · Medición: payload real, endpoint caído, markdown y rangos ─────
{
  const c = caso(2, 'Integración frágil: medición sin datos personales y servicio de agentes');
  const { p, red } = await pagina({ url: BASE + '?utm_source=instagram' });
  await p.click('.portada__acciones a[data-wa]');
  await p.waitForSelector('#panel-wa[open]');
  await p.click('#panel-wa input[name="q1"][value="preventa"] + span');
  await p.click('#panel-wa input[name="q2"][value="este_mes"] + span');
  await p.click('#panel-wa-abrir');
  await espera(300);
  await p.bringToFront();
  await p.click('a[data-evento="ver_casos"]');
  await espera(1500);
  await p.$eval('a[data-evento="correo"]', a => { a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); });
  await espera(800);
  const tipos = red.eventos.map(e => e.tipo);
  const camposRaros = red.eventos.flatMap(e => Object.keys(e).filter(k => !CAMPOS_PERMITIDOS.has(k)));
  const valoresConDigitos = red.eventos.flatMap(e => Object.values(e).filter(v => /\d{3,}/.test(String(v))));
  if (camposRaros.length || valoresConDigitos.length) c.fallos.push(`Payload con campos o valores de más: ${[...camposRaros, ...valoresConDigitos].join(', ')}`);
  for (const t of ['visita', 'whatsapp_panel_abierto', 'whatsapp_enviado', 'ver_casos', 'casos_vistos', 'correo']) if (!tipos.includes(t)) c.fallos.push(`No salió el evento ${t}`);
  const enviado = red.eventos.find(e => e.tipo === 'whatsapp_enviado') || {};
  if (enviado.q1 !== 'preventa' || enviado.q2 !== 'este_mes' || enviado.origen !== 'instagram') c.fallos.push(`whatsapp_enviado: ${JSON.stringify(enviado)}`);
  if (red.externos.length) c.fallos.push('Peticiones a terceros: ' + red.externos.join(', '));
  c.detalles.push(`Payload real en la red: ${red.eventos.length} eventos, solo con ${[...new Set(red.eventos.flatMap(Object.keys))].join(', ')}. Ejemplo: ${JSON.stringify(enviado)}. Cero peticiones a terceros.`);
  if (!EN_VIVO) {
    const guardados = await (await fetch(BASE + '__eventos')).json();
    const ultimo = guardados.filter(g => g.tipo === 'whatsapp_enviado').at(-1) || {};
    if (ultimo.q1 !== 'preventa' || ultimo.origen !== 'instagram') c.fallos.push('La base local no guardó el evento enviado');
    else c.detalles.push(`La Function lo guardó en la base local: ${JSON.stringify({ tipo: ultimo.tipo, origen: ultimo.origen, boton: ultimo.boton, q1: ultimo.q1, q2: ultimo.q2 })}.`);
  }
  await p.close();

  // Origen por referencia
  for (const [ref, esperado] of [['https://l.instagram.com/', 'instagram'], ['https://chatgpt.com/', 'asistente_ia'], ['https://www.google.com/', 'buscador']]) {
    const v = await pagina({ referer: ref });
    await espera(400);
    const visita = v.red.eventos.find(e => e.tipo === 'visita');
    if (!visita || visita.origen !== esperado) c.fallos.push(`Referencia ${ref} → ${visita && visita.origen}`);
    await v.p.close();
  }
  c.detalles.push('Origen por referencia: l.instagram.com → instagram, chatgpt.com → asistente_ia, google.com → buscador.');

  // Endpoint caído: WhatsApp sigue funcionando
  const caido = await navegador.newPage();
  await caido.setUserAgent(UA_PAGINA);
  await caido.setViewport({ width: 1440, height: 900 });
  await caido.setRequestInterception(true);
  let waAbierto = null;
  caido.on('request', r => {
    if (r.url().includes('/api/evento')) return r.respond({ status: 500, body: 'caído' });
    if (r.url().startsWith('https://wa.me/')) { waAbierto = r.url(); return r.abort(); }
    r.continue();
  });
  const desde = pestanas.length;
  await caido.goto(BASE, { waitUntil: 'networkidle0' });
  await caido.click('.portada__acciones a[data-wa]');
  await caido.waitForSelector('#panel-wa[open]');
  await caido.click('#panel-wa input[name="q1"][value="digital"] + span');
  await caido.click('#panel-wa input[name="q2"][value="sin_fecha"] + span');
  const hrefCaido = await caido.$eval('#panel-wa-abrir', a => a.href);
  await caido.click('#panel-wa-abrir');
  await espera(800);
  await caido.bringToFront();
  const abrio = pestanas.slice(desde).some(esWa) || waAbierto;
  if (textoWa(hrefCaido).texto !== `${P1.digital} ${P2.sin_fecha}` || !abrio) c.fallos.push('Con la medición caída no se abrió WhatsApp');
  else c.detalles.push('Con /api/evento respondiendo 500, el panel igual abre WhatsApp con el mensaje correcto.');
  await caido.close();

  // Markdown por Accept, cabecera Link y rangos del video
  const md = await fetch(BASE, { headers: { Accept: 'text/markdown' } });
  const cuerpo = await md.text();
  if (!/text\/markdown/.test(md.headers.get('content-type')) || !cuerpo.startsWith('# Geiser Elligon')) c.fallos.push(`Accept: text/markdown → ${md.headers.get('content-type')}`);
  const html = await fetch(BASE, { headers: { Accept: 'text/html' } });
  if (!/accept/i.test(html.headers.get('vary') || '') || !/rel="describedby"/.test(html.headers.get('link') || '')) c.fallos.push(`HTML sin Vary: Accept o sin Link: ${html.headers.get('vary')} | ${html.headers.get('link')}`);
  const pagHtml = await html.text();
  const video = (/data-src="([^"]+\.mp4)"/.exec(pagHtml) || [])[1];
  const rango = await fetch(new URL(video, BASE), { headers: { Range: 'bytes=0-1023' } });
  await rango.arrayBuffer();
  if (rango.status !== 206 || !/^bytes 0-1023\//.test(rango.headers.get('content-range') || '')) c.fallos.push(`Rango del video: ${rango.status} ${rango.headers.get('content-range')}`);
  c.detalles.push(`Accept: text/markdown → ${md.headers.get('content-type')} (${cuerpo.length} caracteres); HTML con Vary: Accept y Link; video por rangos → ${rango.status} ${rango.headers.get('content-range')}.`);
}

// ── Caso 3 · Validación del endpoint de medición ─────────────────────────
{
  const c = caso(3, 'Validación de entrada: el endpoint rechaza lo que no es suyo');
  const url = BASE + 'api/evento';
  const origen = new URL(BASE).origin;
  const contar = async () => EN_VIVO ? null : (await (await fetch(BASE + '__eventos')).json()).length;
  const antes = await contar();
  const enviar = (cuerpo, cab = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origen, 'Sec-Fetch-Site': 'same-origin', 'User-Agent': UA, ...cab }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) }).then(r => r.status);
  const pruebas = [
    ['otro sitio', { tipo: 'visita', origen: 'directo' }, { Origin: 'https://otro.example', 'Sec-Fetch-Site': 'cross-site' }, 403],
    ['campo extra con teléfono', { tipo: 'visita', origen: 'directo', telefono: '04141234567' }, {}, 400],
    ['tipo inventado', { tipo: 'compra', origen: 'directo' }, {}, 400],
    ['origen inventado', { tipo: 'visita', origen: 'facebook' }, {}, 400],
    ['q1 inventada', { tipo: 'whatsapp_enviado', origen: 'directo', boton: 'nav', q1: 'otra', q2: 'este_mes' }, {}, 400],
    ['enviado sin q2', { tipo: 'whatsapp_enviado', origen: 'directo', boton: 'nav', q1: 'producto' }, {}, 400],
    ['botón inventado', { tipo: 'whatsapp_panel_abierto', origen: 'directo', boton: 'hack' }, {}, 400],
    ['cuerpo gigante', JSON.stringify({ tipo: 'visita', origen: 'directo', boton: 'x'.repeat(600) }), {}, 413],
    ['JSON roto', '{tipo:', {}, 400],
    ['robot', { tipo: 'visita', origen: 'directo' }, { 'User-Agent': 'Googlebot/2.1' }, 204]
  ];
  for (const [nombre, cuerpo, cab, esperado] of pruebas) {
    const estado = await enviar(cuerpo, cab);
    if (estado !== esperado) c.fallos.push(`${nombre}: ${estado} (esperado ${esperado})`);
  }
  const get = await fetch(url).then(r => r.status);
  if (get !== 405) c.fallos.push(`GET: ${get}`);
  const despues = await contar();
  if (!EN_VIVO && despues !== antes) c.fallos.push(`Se guardaron ${despues - antes} filas que debían rechazarse`);
  const valido = EN_VIVO ? 'omitido en vivo' : await enviar({ tipo: 'whatsapp_enviado', origen: 'linkedin', boton: 'servicio-diagnostico', q1: 'definiendo', q2: 'uno_a_tres' });
  if (!EN_VIVO && valido !== 204) c.fallos.push(`Evento válido: ${valido}`);
  c.detalles.push(`${pruebas.length} entradas malas: otro sitio → 403, teléfono colado / tipo, origen, botón o respuesta inventados / JSON roto → 400, cuerpo gigante → 413, robot → 204 sin guardar; GET → 405.${EN_VIVO ? '' : ` Filas nuevas por las malas: ${despues - antes}.`} Un evento válido → ${valido}.`);
}

// ── Caso 4 · Sin JavaScript: mismo texto y WhatsApp sigue funcionando ─────
{
  const c = caso(4, 'Regla cara: sin JavaScript se lee todo y WhatsApp abre igual');
  const texto = async p => p.evaluate(() => {
    const main = document.querySelector('main').cloneNode(true);
    main.querySelectorAll('[data-duplicado], .cinta').forEach(n => n.remove());
    return main.textContent.replace(/\s+/g, ' ').trim();
  });
  const sin = await pagina({ js: false });
  const tSin = await texto(sin.p);
  const hrefs = await sin.p.$$eval('a[data-wa]', as => as.map(a => a.href));
  const malos = hrefs.filter(h => { const u = new URL(h); return u.host !== 'wa.me' || u.pathname !== '/584142533279' || !u.searchParams.get('text').startsWith('Hola Geiser'); });
  if (malos.length) c.fallos.push(`Enlaces sin JS mal formados: ${malos.length}`);
  const desdeSin = pestanas.length;
  await sin.p.click('.portada__acciones a[data-wa]');
  await espera(800);
  await sin.p.bringToFront();
  if (![...sin.red.wa, ...pestanas.slice(desdeSin)].some(u => esWa(u) && textoWa(u).texto === DIRECTO)) c.fallos.push('Sin JS, el botón de la portada no abrió WhatsApp');
  if (sin.red.mp4.length) c.fallos.push('Sin JS se descargó video');
  await sin.p.close();

  const con = await pagina({ ancho: 1440, alto: 900 });
  const alto = await con.p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < alto + 2000; y += 500) { await con.p.evaluate(y => window.scrollTo(0, y), y); await espera(120); }
  await espera(2500);
  const tCon = await texto(con.p);
  await con.p.close();
  if (tSin !== tCon) {
    const a = tSin.split(' '), b = tCon.split(' ');
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    c.fallos.push(`El texto cambia con JS en la palabra ${i}: sin JS «${a.slice(i, i + 8).join(' ')}» / con JS «${b.slice(i, i + 8).join(' ')}»`);
  }
  c.detalles.push(`Texto de <main>: ${tSin.length} caracteres sin JS y ${tCon.length} con JS (después de recorrer la página): ${tSin === tCon ? 'idénticos' : 'distintos'}.`);
  c.detalles.push(`${hrefs.length} botones de WhatsApp sin JS, todos enlaces válidos a wa.me/584142533279; el de la portada abre «${DIRECTO}». Sin JS no se descarga video.`);
}

// ── Caso 5 · Bordes: movimiento, datos, ancho, teclado y carga ────────────
{
  const c = caso(5, 'Bordes: movimiento reducido, ahorro de datos, ancho, teclado y LCP');

  const q = await pagina({ quieto: true });
  for (let y = 0; y < 9000; y += 900) { await q.p.evaluate(y => window.scrollTo(0, y), y); await espera(100); }
  await espera(1500);
  const estado = await q.p.evaluate(() => ({
    pins: document.querySelectorAll('.pin-spacer').length,
    animaciones: document.getAnimations().filter(a => a.playState === 'running').length,
    gsap: window.gsap ? window.gsap.globalTimeline.getChildren(true, true, false).filter(x => x.targets && x.targets().some(o => o instanceof Element)).length : 0,
    videos: [...document.querySelectorAll('video')].filter(v => v.getAttribute('src')).length,
    cinta: getComputedStyle(document.querySelector('.cinta__pista')).transform
  }));
  if (estado.pins || estado.animaciones || estado.gsap || estado.videos || (estado.cinta !== 'none' && estado.cinta !== 'matrix(1, 0, 0, 1, 0, 0)')) c.fallos.push(`Con movimiento reducido hay movimiento: ${JSON.stringify(estado)}`);
  else c.detalles.push('Movimiento reducido: sin secciones fijadas, sin animaciones, cinta quieta y sin video.');
  await q.p.close();

  const sd = await pagina({ ancho: 390, alto: 844, saveData: true });
  await espera(1500);
  if (sd.red.mp4.length) c.fallos.push('Con ahorro de datos se descargó video'); else c.detalles.push('Ahorro de datos: no se descarga ningún video.');
  await sd.p.close();

  const n = await pagina({ ancho: 390, alto: 844 });
  await espera(1500);
  const load = await n.p.evaluate(() => performance.timing.loadEventEnd);
  const antesDeLoad = n.red.mp4.filter(v => v.t < load);
  if (!n.red.mp4.length) c.fallos.push('El video de la portada no se cargó después de load');
  if (antesDeLoad.length) c.fallos.push('Se pidió video antes de load');
  else c.detalles.push(`Video de la portada pedido ${n.red.mp4.length ? Math.round(n.red.mp4[0].t - load) + ' ms después' : 'nunca'} de load.`);
  await n.p.close();

  for (const [ancho, alto] of [[360, 740], [768, 1024], [1440, 900]]) {
    const v = await pagina({ ancho, alto });
    const total = await v.p.evaluate(() => document.documentElement.scrollHeight);
    let peor = 0;
    for (let y = 0; y < total + alto * 3; y += Math.round(alto * 0.6)) {
      await v.p.evaluate(y => window.scrollTo(0, y), y);
      await espera(60);
      peor = Math.max(peor, await v.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
    }
    if (peor > 0) c.fallos.push(`Scroll horizontal a ${ancho} px: ${peor} px de más`);
    await v.p.close();
  }
  c.detalles.push('Sin scroll horizontal a 360, 768 y 1440 px, revisando toda la página.');

  const t = await pagina({ ancho: 1440, alto: 900 });
  const vistos = [];
  let sinAnillo = [];
  for (let i = 0; i < 70; i++) {
    await t.p.keyboard.press('Tab');
    await espera(40);
    const info = await t.p.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const s = getComputedStyle(a);
      const anillo = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (a.matches('input') && getComputedStyle(a.nextElementSibling || a).outlineStyle !== 'none');
      return { id: (a.className || a.tagName) + '|' + (a.getAttribute('href') || a.value || ''), anillo };
    });
    if (!info) continue;
    vistos.push(info.id);
    if (!info.anillo) sinAnillo.push(info.id);
  }
  const llegoAlFinal = vistos.some(v => v.includes('linkedin.com'));
  if (!llegoAlFinal) c.fallos.push(`El teclado no llegó al contacto: se quedó en ${vistos.slice(-3).join(' · ')}`);
  if (sinAnillo.length) c.fallos.push(`Foco sin anillo visible: ${[...new Set(sinAnillo)].slice(0, 3).join(' · ')}`);
  const rojoHueso = await t.p.evaluate(() => {
    const color = s => s.replace(/\s/g, '');
    const fondo = el => { while (el) { const b = getComputedStyle(el).backgroundColor; if (b && !/rgba\(0,0,0,0\)|transparent/.test(color(b))) return color(b); el = el.parentElement; } return 'rgb(10,10,10)'; };
    const ROJO = 'rgb(240,55,43)', HUESO = 'rgb(244,244,242)';
    return [...document.querySelectorAll('body *')].filter(el => el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).filter(el => {
      const s = getComputedStyle(el); const tam = parseFloat(s.fontSize); const c = color(s.color); const f = fondo(el);
      return tam < 24 && ((c === ROJO && f === HUESO) || (c === HUESO && f === ROJO));
    }).map(el => el.className || el.tagName);
  });
  if (rojoHueso.length) c.fallos.push(`Rojo/hueso pequeño: ${rojoHueso.join(', ')}`);
  c.detalles.push(`Teclado: ${vistos.length} paradas de tabulación, de la navegación hasta LinkedIn sin quedar atrapado en las secciones fijadas; todas con anillo visible. Ningún texto rojo sobre hueso ni hueso sobre rojo por debajo de 24 px.`);
  await t.p.close();

  // LCP en 4G lento simulado y CPU 4× más lenta (teléfono de gama media)
  const l = await navegador.newPage();
  await l.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const cdp = await l.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await l.evaluateOnNewDocument(() => { window.__lcp = 0; new PerformanceObserver(lista => { for (const e of lista.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
  await l.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await espera(1500);
  const lcp = await l.evaluate(() => ({ ms: Math.round(window.__lcp), elemento: (performance.getEntriesByType('largest-contentful-paint').at(-1) || {}).element?.className || '?' }));
  if (!lcp.ms || lcp.ms > 2500) c.fallos.push(`LCP ${lcp.ms} ms en 4G lento`);
  c.detalles.push(`LCP en 4G lento simulado (1,6 Mbps, 150 ms) con CPU 4× más lenta, a 390 px: ${lcp.ms} ms (elemento: ${lcp.elemento}); el límite es 2.500.`);
  await l.close();
}

await navegador.close();

// ── Informe ──────────────────────────────────────────────────────────────
console.log(`\nVERIFICACIÓN — Landing Geiser Elligon — ${new Date().toLocaleString('es-VE')}`);
console.log(`Contra: ${BASE}${EN_VIVO ? ' (en vivo, sin escribir en la base)' : ''}\n`);
for (const r of resultados) {
  console.log(`Caso ${r.n} — ${r.titulo}: ${r.fallos.length ? 'FALLA' : 'PASA'}`);
  for (const d of r.detalles) console.log('   · ' + d);
  for (const f of r.fallos) console.log('   ✗ ' + f);
}
const fallan = resultados.filter(r => r.fallos.length);
console.log(`\nVeredicto: ${fallan.length ? 'BLOQUEADO por el caso ' + fallan.map(r => r.n).join(', ') : 'LUZ VERDE'}`);
process.exit(fallan.length ? 1 : 0);
