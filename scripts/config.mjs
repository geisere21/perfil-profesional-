// Configuración compartida por los scripts. Rutas, nombres externos y listas cerradas.
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = join(RAIZ, 'dist');
export const CACHE = join(RAIZ, '.cache');
export const MEDIOS = join(RAIZ, 'medios');

/** La lista cerrada de medios permitidos vive aquí (spec, sección 4). */
export const ASSETS_FUENTE = join(RAIZ, '..', 'assets');
/** Lo que está aquí nunca se publica: fotos sin camisa. */
export const CARPETA_EXCLUIDA = join(RAIZ, '..', '_to_delete');
/** SHA-256 de lo excluido, para que la regla funcione aunque la carpeta no esté en otra máquina. */
export const HASH_EXCLUIDOS = [
  '46d98390babe5f158b633db5cee6ead45e9765a85c57cc27499245c4c1334db0' // _to_delete/geiser-gym.jpg
];

export const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const PROYECTO_CF = 'geiser-elligon';
export const D1_NOMBRE = 'geiser-elligon-medicion';
export const PUERTO_LOCAL = Number(process.env.PUERTO || 8098);

export const leerSitio = () => JSON.parse(readFileSync(join(RAIZ, 'datos', 'sitio.json'), 'utf8'));

/** Todos los archivos de medios que la página usa, sacados de sitio.json. */
export function mediosUsados(sitio) {
  const s = new Set([sitio.persona.foto_perfil, sitio.portada.video.src, sitio.portada.video.poster]);
  for (const c of sitio.casos.filter(c => c.publicado)) for (const m of c.media) { s.add(m.src); if (m.poster) s.add(m.poster); }
  for (const c of sitio.digital.capas) s.add(c.src);
  s.add(sitio.como_trabajo.foto.src);
  s.add(sitio.fuera.video.src); s.add(sitio.fuera.video.poster); s.add(sitio.fuera.foto.src);
  return [...s].filter(Boolean).sort();
}
