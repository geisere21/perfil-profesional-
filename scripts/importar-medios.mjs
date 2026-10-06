/**
 * Copia a web/medios/ los medios que usa sitio.json, desde la lista cerrada
 * (../assets) y sin metadatos. No recomprime: quita los bloques EXIF/XMP/IPTC
 * del JPG, los fragmentos de texto del PNG y las etiquetas del MP4.
 *
 *   node scripts/importar-medios.mjs
 *
 * Falla si un medio no está en ../assets, si se llama igual que algo de
 * _to_delete o si su contenido coincide con algo excluido.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ASSETS_FUENTE, CARPETA_EXCLUIDA, HASH_EXCLUIDOS, MEDIOS, leerSitio, mediosUsados } from './config.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');

/** JPG: conserva SOI, APP0 (JFIF), APP2 (perfil ICC) y todo desde SOS. Quita APP1 (Exif/XMP), APP13 (IPTC), COM. */
function jpgSinMetadatos(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('No es JPG');
  const partes = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xFF) throw new Error('JPG mal formado en ' + i);
    const m = b[i + 1];
    if (m === 0xDA) { partes.push(b.subarray(i)); break; }          // inicio de la imagen: el resto va entero
    const largo = b.readUInt16BE(i + 2);
    const quitar = (m >= 0xE1 && m <= 0xEF && m !== 0xE2) || m === 0xFE;
    if (!quitar) partes.push(b.subarray(i, i + 2 + largo));
    i += 2 + largo;
  }
  return Buffer.concat(partes);
}

/** PNG: quita tEXt, iTXt, zTXt, eXIf y tIME. */
function pngSinMetadatos(b) {
  const partes = [b.subarray(0, 8)];
  let i = 8;
  while (i < b.length) {
    const largo = b.readUInt32BE(i);
    const tipo = b.subarray(i + 4, i + 8).toString('latin1');
    const total = 12 + largo;
    if (!['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(tipo)) partes.push(b.subarray(i, i + total));
    i += total;
  }
  return Buffer.concat(partes);
}

function mp4SinMetadatos(origen, destino) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', origen, '-map', '0', '-map_metadata', '-1',
    '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', destino]);
}

const sitio = leerSitio();
const usados = mediosUsados(sitio);
const excluidosPorNombre = existsSync(CARPETA_EXCLUIDA) ? readdirSync(CARPETA_EXCLUIDA) : [];
const excluidosPorHash = new Set(HASH_EXCLUIDOS);
if (existsSync(CARPETA_EXCLUIDA)) for (const f of excluidosPorNombre) excluidosPorHash.add(sha(readFileSync(join(CARPETA_EXCLUIDA, f))));

mkdirSync(MEDIOS, { recursive: true });
const manifiesto = [];
const errores = [];

for (const nombre of usados) {
  const origen = join(ASSETS_FUENTE, nombre);
  if (excluidosPorNombre.includes(nombre)) { errores.push(`${nombre} está en _to_delete/`); continue; }
  if (!existsSync(origen)) { errores.push(`${nombre} no está en assets/ (lista cerrada)`); continue; }
  const bruto = readFileSync(origen);
  if (excluidosPorHash.has(sha(bruto))) { errores.push(`${nombre} coincide con una foto excluida`); continue; }

  const destino = join(MEDIOS, nombre);
  const ext = extname(nombre).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') writeFileSync(destino, jpgSinMetadatos(bruto));
  else if (ext === '.png') writeFileSync(destino, pngSinMetadatos(bruto));
  else if (ext === '.mp4') mp4SinMetadatos(origen, destino);
  else { errores.push(`${nombre}: tipo no previsto`); continue; }

  manifiesto.push({ archivo: nombre, sha256_fuente: sha(bruto), sha256_copia: sha(readFileSync(destino)) });
}

// Lo que sobra en medios/ y ya no usa sitio.json, sale.
for (const f of readdirSync(MEDIOS)) {
  if (f === 'manifiesto.json') continue;
  if (!usados.includes(f)) { rmSync(join(MEDIOS, f)); console.log('  quitado (ya no se usa):', f); }
}

if (errores.length) {
  console.error('\nNo se importó:\n  ' + errores.join('\n  '));
  process.exit(1);
}
writeFileSync(join(MEDIOS, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2) + '\n');
console.log(`${manifiesto.length} medios importados desde assets/, sin metadatos.`);
