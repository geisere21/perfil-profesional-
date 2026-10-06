/**
 * Miniatura para compartir (1200 × 630, JPG < 300 KB) e íconos, renderizados
 * en Chrome real a partir de HTML con las mismas fuentes y el mismo póster de
 * la portada. Caché por contenido: solo se regeneran si cambian sus insumos.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { CACHE, CHROME } from '../config.mjs';

const DIR = join(CACHE, 'og');
mkdirSync(DIR, { recursive: true });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const dataUri = (ruta, tipo) => `data:${tipo};base64,${readFileSync(ruta).toString('base64')}`;

function htmlOg(s, fuentes, foto) {
  // Foto real a la izquierda (el lanzamiento de Push Roll) y el nombre grande a la derecha:
  // en el tamaño chico de WhatsApp se lee el nombre y se ve una persona, no una textura oscura.
  const [nombre1, ...resto] = s.persona.nombre.split(' ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Anton;src:url(${fuentes.anton})}
@font-face{font-family:Inter;font-weight:600;src:url(${fuentes.inter600})}
*{margin:0;box-sizing:border-box}
html,body{width:1200px;height:630px;background:#0A0A0A;overflow:hidden}
.foto{position:absolute;left:0;top:0;width:500px;height:630px;background:url(${foto}) 50% 17%/cover;filter:saturate(1.06) contrast(1.04)}
.foto::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,10,10,0) 70%,#0A0A0A 100%)}
.texto{position:absolute;left:548px;right:56px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
h1{font:400 178px/.84 Anton;color:#F4F4F2;text-transform:uppercase;letter-spacing:.002em}
h1 span{display:block}
.frase{font:600 34px/1.15 Inter;color:#F4F4F2;letter-spacing:-.01em;margin-top:26px}
.chips{margin-top:22px;display:flex;gap:10px}
.chip{font:600 16px/1 Inter;letter-spacing:.08em;text-transform:uppercase;color:#0A0A0A;padding:10px 14px;border-radius:99px}
</style></head><body>
<div class="foto"></div>
<div class="texto"><h1><span>${esc(nombre1)}</span><span>${esc(resto.join(' '))}</span></h1>
<p class="frase">${esc(s.persona.frase_identidad)}</p>
<div class="chips"><span class="chip" style="background:#F0372B">${esc(s.portada.chip_fisico)}</span><span class="chip" style="background:#D7FF2B">${esc(s.portada.chip_digital)}</span></div></div>
</body></html>`;
}

function htmlIcono(s, fuentes, lado) {
  const iniciales = s.persona.nombre.split(' ').map(p => p[0]).join('').toUpperCase();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Anton;src:url(${fuentes.anton})}
*{margin:0}html,body{width:${lado}px;height:${lado}px;background:#0A0A0A;overflow:hidden}
div{width:100%;height:100%;display:grid;place-items:center;font:400 ${Math.round(lado * 0.58)}px/1 Anton;color:#F4F4F2;letter-spacing:.01em;position:relative}
i{position:absolute;left:22%;right:22%;bottom:17%;height:${Math.round(lado * 0.045)}px;background:#D7FF2B}
</style></head><body><div>${esc(iniciales)}<i></i></div></body></html>`;
}

export async function generarOgEIconos(s, { rutaAnton, rutaInter600, rutaFoto, distDir }) {
  const fuentes = { anton: dataUri(rutaAnton, 'font/woff2'), inter600: dataUri(rutaInter600, 'font/woff2') };
  const foto = dataUri(rutaFoto, 'image/jpeg');
  const og = htmlOg(s, fuentes, foto);
  const icono = htmlIcono(s, fuentes, 512);
  const clave = createHash('sha256').update(og + icono + 'v3').digest('hex').slice(0, 16);
  const ogJpg = join(DIR, `og-${clave}.jpg`);
  const iconoPng = join(DIR, `icono-${clave}-512.png`);

  if (!existsSync(ogJpg) || !existsSync(iconoPng)) {
    const navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
    try {
      const p = await navegador.newPage();
      await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
      await p.setContent(og, { waitUntil: 'load' });
      await p.evaluate(() => document.fonts.ready);
      await p.screenshot({ path: join(DIR, 'og.png') });
      await p.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
      await p.setContent(icono, { waitUntil: 'load' });
      await p.evaluate(() => document.fonts.ready);
      await p.screenshot({ path: iconoPng });
    } finally { await navegador.close(); }
    // JPG sin metadatos; se baja la calidad hasta quedar bajo 300 KB.
    for (const q of [3, 4, 5, 6, 8]) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(DIR, 'og.png'), '-q:v', String(q), '-map_metadata', '-1', '-pix_fmt', 'yuvj420p', ogJpg]);
      if (readFileSync(ogJpg).length < 280 * 1024) break;
    }
  }

  mkdirSync(distDir, { recursive: true });
  // El nombre cambia con el contenido: WhatsApp y Facebook guardan la miniatura por URL.
  const nombreOg = `miniatura-${clave.slice(0, 8)}.jpg`;
  copyFileSync(ogJpg, join(distDir, nombreOg));
  const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  ff(['-i', iconoPng, '-vf', 'scale=180:180:flags=lanczos', join(distDir, 'apple-touch-icon.png')]);
  ff(['-i', iconoPng, '-vf', 'scale=32:32:flags=lanczos', join(distDir, 'icono-32.png')]);
  ff(['-i', iconoPng, '-vf', 'scale=48:48:flags=lanczos', join(distDir, 'favicon.ico')]);
  ff(['-i', iconoPng, '-vf', 'scale=192:192:flags=lanczos', join(distDir, 'icono-192.png')]);
  return { og: nombreOg, bytes: readFileSync(ogJpg).length };
}
