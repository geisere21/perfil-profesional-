/**
 * Un solo comando de despliegue. No publica si algo falla antes.
 *
 *   node scripts/desplegar.mjs
 *
 * 1. Importa medios, construye y corre el verificador AEO (32 criterios).
 * 2. Corre las pruebas en Chrome real contra el servidor local.
 * 3. Aplica las migraciones de D1 y publica en Cloudflare Pages con Wrangler
 *    (arrastrar la carpeta al dashboard no sube functions/).
 * 4. scripts/comprobar-en-vivo.mjs: lo publicado es idéntico a lo construido,
 *    markdown, cabeceras, rangos y endpoint en vivo, y las pruebas de navegador
 *    contra la URL publicada (sin escribir en la base).
 */
import { execSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { RAIZ, DIST, PROYECTO_CF, D1_NOMBRE, PUERTO_LOCAL, leerSitio } from './config.mjs';

const sh = cmd => execSync(cmd, { stdio: 'inherit', cwd: RAIZ });
const paso = t => console.log(`\n━━ ${t} ${'━'.repeat(Math.max(0, 70 - t.length))}`);
const espera = ms => new Promise(r => setTimeout(r, ms));
const URL_SITIO = leerSitio().sitio.url;

paso('1. Medios, build y verificador');
sh('node scripts/importar-medios.mjs');
sh('node scripts/construir.mjs');
sh('node scripts/verificar-aeo.mjs ./dist');

paso('2. Pruebas en navegador (local)');
const ocupado = await new Promise(r => { const s = createConnection(PUERTO_LOCAL, '127.0.0.1').on('connect', () => { s.end(); r(true); }).on('error', () => r(false)); });
let servidor = null;
if (!ocupado) { servidor = spawn(process.execPath, ['scripts/servir.mjs'], { cwd: RAIZ, stdio: 'ignore' }); await espera(1500); }
try { sh('node scripts/pruebas-navegador.mjs'); }
finally { if (servidor) servidor.kill(); }

paso('3. Migraciones de D1 y publicación');
sh(`npx wrangler d1 migrations apply ${D1_NOMBRE} --remote`);
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: RAIZ }).toString().trim(); } catch { return 'sin-commit'; } })();
sh(`npx wrangler pages deploy dist --project-name ${PROYECTO_CF} --branch main --commit-dirty=true --commit-hash ${commit} --commit-message "Landing v2 ${new Date().toISOString().slice(0, 16)}"`);

sh('node scripts/comprobar-en-vivo.mjs');
console.log(`
Publicado y verificado: ${URL_SITIO}`);
