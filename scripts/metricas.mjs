/**
 * Las métricas del spec (sección 6), leídas de D1 y escritas con su denominador.
 *
 *   node scripts/metricas.mjs            → últimos 28 días
 *   node scripts/metricas.mjs 7          → últimos 7 días
 */
import { execFileSync } from 'node:child_process';
import { D1_NOMBRE, RAIZ, leerSitio } from './config.mjs';

const dias = Number(process.argv[2] || 28);
const s = leerSitio();
const consulta = sql => {
  const salida = execFileSync('npx', ['wrangler', 'd1', 'execute', D1_NOMBRE, '--remote', '--json', '--command', sql], { cwd: RAIZ, shell: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return JSON.parse(salida)[0].results;
};
const desde = `datetime('now', '-${dias} days')`;
const filas = consulta(`SELECT tipo, origen, boton, q1, q2, strftime('%Y-%W', creado) AS semana FROM eventos WHERE creado >= ${desde}`);

const contar = (lista, clave) => lista.reduce((m, f) => (m[f[clave] ?? '—'] = (m[f[clave] ?? '—'] || 0) + 1, m), {});
const visitas = filas.filter(f => f.tipo === 'visita');
const conversaciones = filas.filter(f => ['whatsapp_enviado', 'whatsapp_directo', 'correo'].includes(f.tipo));
const enviados = filas.filter(f => f.tipo === 'whatsapp_enviado');
const nombreOrigen = o => s.medicion.origenes[o] || o;
const texto = (v, lista) => s.whatsapp_panel[lista].find(o => o.valor === v)?.texto || v;

console.log(`\nLanding · últimos ${dias} días\n`);
console.log(`Visitas: ${visitas.length}`);
for (const [o, n] of Object.entries(contar(visitas, 'origen')).sort((a, b) => b[1] - a[1])) console.log(`  ${n} de ${visitas.length} desde ${nombreOrigen(o)}`);

console.log(`\nConversaciones iniciadas (WhatsApp desde el panel, WhatsApp directo y correo): ${conversaciones.length}`);
for (const [sem, n] of Object.entries(contar(conversaciones, 'semana'))) console.log(`  semana ${sem}: ${n}`);
for (const [o, n] of Object.entries(contar(conversaciones, 'origen')).sort((a, b) => b[1] - a[1])) console.log(`  ${n} de ${conversaciones.length} llegaron desde ${nombreOrigen(o)}`);

console.log(`\nQué piden (${enviados.length} mensajes armados con el panel):`);
for (const [q, n] of Object.entries(contar(enviados, 'q1')).sort((a, b) => b[1] - a[1])) console.log(`  ${n} de ${enviados.length}: ${texto(q, 'opciones1')}`);
console.log('Para cuándo:');
for (const [q, n] of Object.entries(contar(enviados, 'q2')).sort((a, b) => b[1] - a[1])) console.log(`  ${n} de ${enviados.length}: ${texto(q, 'opciones2')}`);

const casos = filas.filter(f => f.tipo === 'casos_vistos').length;
console.log(`\nVisitas que llegan a Casos: ${casos} de ${visitas.length}`);
console.log(`Paneles abiertos: ${filas.filter(f => f.tipo === 'whatsapp_panel_abierto').length} · mensajes armados: ${enviados.length} · directo: ${filas.filter(f => f.tipo === 'whatsapp_directo').length}\n`);
