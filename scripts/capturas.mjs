/**
 * Capturas de revisión en Chrome real, en tamaños de teléfono y escritorio.
 *
 *   node scripts/capturas.mjs <url> <carpeta> [ancho×alto ...]
 *
 * Por cada tamaño guarda la primera pantalla y una captura por cada sección
 * principal. Con --sin-js, --quieto (movimiento reducido) o --completa (toda la
 * página en una imagen) cambia el modo.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME } from './config.mjs';

const args = process.argv.slice(2);
const banderas = new Set(args.filter(a => a.startsWith('--')));
const [url, carpeta, ...tamanos] = args.filter(a => !a.startsWith('--'));
const vistas = (tamanos.length ? tamanos : ['390x844', '1440x900']).map(t => t.split('x').map(Number));
mkdirSync(carpeta, { recursive: true });
const espera = ms => new Promise(r => setTimeout(r, ms));

const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
for (const [ancho, alto] of vistas) {
  const p = await navegador.newPage();
  const movil = ancho < 820;
  await p.setViewport({ width: ancho, height: alto, deviceScaleFactor: movil ? 2 : 1, isMobile: movil, hasTouch: movil });
  if (banderas.has('--sin-js')) await p.setJavaScriptEnabled(false);
  if (banderas.has('--quieto')) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const errores = [];
  p.on('pageerror', e => errores.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  await p.goto(url, { waitUntil: 'networkidle0' });
  await espera(1200);
  const pref = `${ancho}x${alto}${banderas.has('--sin-js') ? '-sinjs' : ''}${banderas.has('--quieto') ? '-quieto' : ''}`;
  if (banderas.has('--completa')) {
    // Recorre la página para que se disparen las animaciones, luego captura entera.
    const total = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += alto * 0.7) { await p.evaluate(y => window.scrollTo(0, y), y); await espera(250); }
    await p.evaluate(() => window.scrollTo(0, 0)); await espera(600);
    await p.screenshot({ path: join(carpeta, `${pref}-completa.png`), fullPage: true });
  } else {
    await p.screenshot({ path: join(carpeta, `${pref}-00-portada.png`) });
    const total = await p.evaluate(() => document.documentElement.scrollHeight);
    let n = 1;
    for (let y = alto; y < total; y += alto) {
      await p.evaluate(y => window.scrollTo(0, y), y);
      await espera(900);
      await p.screenshot({ path: join(carpeta, `${pref}-${String(n++).padStart(2, '0')}.png`) });
      if (n > 40) break;
    }
  }
  const ancho_doc = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  console.log(`${pref}: alto total ${await p.evaluate(() => document.documentElement.scrollHeight)} px · scrollWidth ${ancho_doc[0]} / clientWidth ${ancho_doc[1]}${errores.length ? ' · ERRORES: ' + errores.join(' | ') : ''}`);
  await p.close();
}
await navegador.close();
