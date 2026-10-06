/**
 * Genera las variantes servidas de cada medio, con ffmpeg y una caché por
 * contenido: si el original y los parámetros no cambian, no se recalcula.
 *
 * Imágenes: WebP en varios anchos + un JPG de respaldo. Las fotos (no las
 * capturas de pantalla) reciben un viraje cálido leve, como en Instagram.
 * Videos: H.264 sin audio, inicio rápido, sin metadatos.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CACHE, MEDIOS } from '../config.mjs';

const DIR = join(CACHE, 'medios');
mkdirSync(DIR, { recursive: true });
const INDICE = join(DIR, 'indice.json');
const indice = existsSync(INDICE) ? JSON.parse(readFileSync(INDICE, 'utf8')) : {};
const VERSION = 'v3';

const sha = b => createHash('sha256').update(b).digest('hex').slice(0, 16);
const ff = args => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });

export function dimensiones(ruta) {
  const salida = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', ruta]).toString().trim();
  const [ancho, alto] = salida.split(',').map(Number);
  return { ancho, alto };
}

const VIRAJE = 'colorbalance=rs=0.035:gs=0.006:bs=-0.035:rm=0.02:bm=-0.02,eq=saturation=1.04';

/**
 * @returns {{ancho:number, alto:number, webp:{ancho:number, archivo:string}[], jpg:{ancho:number, archivo:string}}}
 */
export function procesarImagen(nombre, { anchos = [480, 800, 1200], foto = false, anchoJpg = 800 } = {}) {
  const origen = join(MEDIOS, nombre);
  const bruto = readFileSync(origen);
  const clave = `${VERSION}|img|${nombre}|${sha(bruto)}|${anchos.join(',')}|${foto}|${anchoJpg}`;
  if (indice[clave] && indice[clave].webp.every(v => existsSync(join(DIR, v.archivo)))) return indice[clave];

  const { ancho, alto } = dimensiones(origen);
  const base = parse(nombre).name;
  const validos = [...new Set(anchos.map(a => Math.min(a, ancho)))].sort((a, b) => a - b);
  const filtro = a => `scale=${a}:-2:flags=lanczos${foto ? ',' + VIRAJE : ''}`;
  const webp = [];
  for (const a of validos) {
    const archivo = `${base}-${a}.webp`;
    ff(['-i', origen, '-vf', filtro(a), '-c:v', 'libwebp', '-quality', foto ? '76' : '82', '-compression_level', '6', '-map_metadata', '-1', join(DIR, archivo)]);
    webp.push({ ancho: a, archivo });
  }
  const aj = Math.min(anchoJpg, ancho);
  const jpgArchivo = `${base}-${aj}.jpg`;
  ff(['-i', origen, '-vf', filtro(aj) + ',format=yuvj420p', '-q:v', '4', '-map_metadata', '-1', join(DIR, jpgArchivo)]);

  const r = { ancho, alto, webp, jpg: { ancho: aj, archivo: jpgArchivo } };
  indice[clave] = r;
  writeFileSync(INDICE, JSON.stringify(indice, null, 1));
  return r;
}

export function procesarVideo(nombre, { crf = 27 } = {}) {
  const origen = join(MEDIOS, nombre);
  const bruto = readFileSync(origen);
  const clave = `${VERSION}|vid|${nombre}|${sha(bruto)}|${crf}`;
  if (indice[clave] && existsSync(join(DIR, indice[clave].archivo))) return indice[clave];
  const { ancho, alto } = dimensiones(origen);
  const archivo = nombre;
  ff(['-i', origen, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', join(DIR, archivo)]);
  const r = { ancho, alto, archivo, bytes: readFileSync(join(DIR, archivo)).length };
  indice[clave] = r;
  writeFileSync(INDICE, JSON.stringify(indice, null, 1));
  return r;
}

/** Copia a dist/medios lo generado. */
export function publicar(archivo, destinoDir) {
  mkdirSync(destinoDir, { recursive: true });
  copyFileSync(join(DIR, archivo), join(destinoDir, archivo));
}
