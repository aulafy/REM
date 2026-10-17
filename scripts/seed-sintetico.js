#!/usr/bin/env node
// Genera datos enteramente ficticios para pruebas locales en una carpeta temporal.
import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb } from '../src/db.js';
import { ACTION_TYPES, normalizeAction } from '../src/agent.js';

const DEFAULT_COUNT = 100;
const DEFAULT_SEED = 42;
const GROUPS = [
  ['clients', 30], ['tasks', 25], ['inbox', 20],
  ['proposals', 15], ['errands', 5], ['audit', 5],
];

function fail(message) { throw new Error(message); }

export function parseArgs(argv) {
  const values = { count: DEFAULT_COUNT, seed: DEFAULT_SEED, dataDir: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!['--data-dir', '--count', '--seed'].includes(arg)) fail(`Argumento desconocido: ${arg}`);
    if (i + 1 >= argv.length) fail(`Falta el valor de ${arg}`);
    const value = argv[++i];
    if (arg === '--data-dir') values.dataDir = value;
    if (arg === '--count') values.count = Number(value);
    if (arg === '--seed') values.seed = Number(value);
  }
  if (!values.dataDir) fail('Uso: node scripts/seed-sintetico.js --data-dir <dir> [--count 100] [--seed 42]');
  if (!Number.isSafeInteger(values.count) || values.count < 1) fail('--count debe ser un entero positivo');
  if (!Number.isSafeInteger(values.seed)) fail('--seed debe ser un entero');
  return values;
}

export function safeDataDir(input) {
  let target;
  try { target = realpathSync(input); } catch { fail('--data-dir debe ser una carpeta existente'); }
  const temp = realpathSync(tmpdir());
  const rel = relative(temp, target);
  const underTemp = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  const productionText = resolve(homedir(), 'Library', 'Application Support', 'Pyme1');
  let productionReal = productionText;
  try { productionReal = realpathSync(productionText); } catch { /* Puede no existir. */ }
  if (!underTemp || target === productionReal || resolve(input) === productionText) {
    fail('--data-dir debe estar dentro de la carpeta temporal y no puede ser la carpeta de datos real de REM');
  }
  return target;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

const choice = (random, values) => values[Math.floor(random() * values.length)];
const date = (offset) => {
  if (offset === null) return '';
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function allocate(total) {
  const raw = GROUPS.map(([name, weight]) => ({ name, exact: total * weight / 100 }));
  const counts = Object.fromEntries(raw.map(({ name, exact }) => [name, Math.floor(exact)]));
  let remaining = total - Object.values(counts).reduce((sum, n) => sum + n, 0);
  for (const item of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1) || GROUPS.findIndex(([n]) => n === a.name) - GROUPS.findIndex(([n]) => n === b.name))) {
    if (remaining-- <= 0) break;
    counts[item.name] += 1;
  }
  return counts;
}

const firstNames = ['Alba', 'Bruno', 'Celia', 'Darío', 'Elena', 'Fabián', 'Gala', 'Hugo', 'Inés', 'Jairo', 'Lara', 'Mateo', 'Nerea', 'Óscar', 'Paula', 'Quim', 'Rocío', 'Saúl', 'Teresa', 'Unai'];
const lastNames = ['Alameda', 'Bermejo', 'Castaño', 'Dorado', 'Encinar', 'Ferrer', 'Granado', 'Herranz', 'Izquierdo', 'Jordán', 'Linares', 'Montalvo', 'Noguera', 'Olmedo', 'Paredes'];
const notes = [
  'Prefiere contacto por la mañana.', 'Solicita documentación en PDF.', 'Interesado en mantenimiento trimestral.',
  'Atención habitual por correo.', 'Pendiente de confirmar el alcance.', 'Prefiere explicaciones breves y claras.',
];

function clientData(i, random) {
  const first = firstNames[i % firstNames.length];
  const last = lastNames[(i * 7 + Math.floor(random() * lastNames.length)) % lastNames.length];
  const tag = String(i + 1).padStart(3, '0');
  return {
    name: `${first} ${last} (Ficción ${tag})`,
    email: `cliente.${tag}@example.test`,
    phone: `600000${tag}`,
    notes: choice(random, notes),
  };
}

function proposalCandidate(i, clients, random) {
  const client = clients.length ? choice(random, clients) : null;
  const clientName = client?.name || 'Contacto ficticio';
  const kind = ['crear_tarea', 'crear_cliente', 'anadir_nota', 'redactar_mensaje'][i % 4];
  if (kind === 'crear_tarea') return { tipo: kind, titulo: `Revisar solicitud sintética ${i + 1}`, fecha: date([0, 2, 7][i % 3]), cliente: clientName };
  if (kind === 'crear_cliente') return { tipo: kind, nombre: `Empresa Ficticia ${i + 1}`, email: `alta.${i + 1}@example.test`, telefono: `600001${String(i % 1000).padStart(3, '0')}`, notas: 'Alta sintética para pruebas.' };
  if (kind === 'anadir_nota') return { tipo: kind, cliente: clientName, texto: `Nota sintética ${i + 1}: prefiere recibir confirmación por escrito.` };
  return { tipo: kind, cliente: clientName, canal: i % 2 ? 'whatsapp' : 'correo', asunto: i % 2 ? '' : 'Seguimiento de su solicitud', texto: `Hola. Este es el borrador ficticio número ${i + 1} para confirmar la recepción de su solicitud.`, avisos: [], avisosFecha: [] };
}

const inboxTemplates = [
  ['presupuesto', '¿Podrían enviarme un presupuesto orientativo para el servicio de mantenimiento?', 'Solicita un presupuesto orientativo.'],
  ['cita', 'Querría cambiar la cita y verla el próximo martes por la mañana.', 'Pide cambiar una cita.'],
  ['incidencia', 'La instalación de prueba ha dejado de funcionar y necesitamos una revisión.', 'Comunica una incidencia en una instalación ficticia.'],
  ['administrativo', '¿Me pueden mandar de nuevo la documentación y la factura de ejemplo?', 'Solicita documentación y una factura de ejemplo.'],
];

export function seedSynthetic(db, { count, seed }) {
  const random = mulberry32(seed);
  const counts = allocate(count);
  const templates=[
   {id:'10000000-0000-4000-8000-000000000001',nombre:'Mantenimiento ficticio',asunto:'Propuesta de {{servicio}} para {{cliente}}',cuerpo:'Hola {{cliente}},\n\nTe presentamos nuestra propuesta para {{servicio}} por {{importe}}.\n\nPlazo: {{plazo}}. Validez: {{validez}}.\n\nCondiciones: {{condiciones}}'},
   {id:'10000000-0000-4000-8000-000000000002',nombre:'Proyecto de ejemplo',asunto:'Propuesta comercial · {{servicio}}',cuerpo:'A la atención de {{cliente}}:\n\nServicio: {{servicio}}\nImporte: {{importe}}\nPlazo estimado: {{plazo}}\nValidez de la oferta: {{validez}}\n\n{{condiciones}}'},
   {id:'10000000-0000-4000-8000-000000000003',nombre:'Servicio recurrente ficticio',asunto:'Condiciones para {{servicio}}',cuerpo:'Hola {{cliente}},\n\nEsta propuesta ficticia cubre {{servicio}} con un importe de {{importe}} y un plazo de {{plazo}}. Será válida durante {{validez}}.\n\n{{condiciones}}'},
  ];
  for(const template of templates)if(!db.proposalTemplates.get(template.id,1))db.proposalTemplates.create(template,{id:template.id,at:'2026-01-01T00:00:00.000Z'});
  const clients = [];
  for (let i = 0; i < counts.clients; i += 1) clients.push(db.clients.create(clientData(i, random)));

  const taskVerbs = ['Preparar presupuesto', 'Confirmar cita', 'Revisar incidencia', 'Enviar documentación', 'Comprobar factura'];
  const offsets = [-7, -2, 0, 0, 2, 6, 14, null];
  for (let i = 0; i < counts.tasks; i += 1) {
    const client = clients.length && i % 5 !== 4 ? choice(random, clients) : null;
    const task = db.tasks.create({ title: `${choice(random, taskVerbs)} sintético ${i + 1}`, due: date(offsets[i % offsets.length]), client_id: client?.id ?? null });
    if (i % 6 === 0) db.tasks.setDone(task.id, true);
  }

  const proposals = [];
  for (let i = 0; i < counts.proposals; i += 1) {
    const candidate = proposalCandidate(i, clients, random);
    if (!ACTION_TYPES.includes(candidate.tipo) || candidate.tipo === 'encargar') fail('Tipo de propuesta sintética no permitido');
    const payload = normalizeAction(candidate);
    if (!payload) fail(`Propuesta sintética inválida: ${candidate.tipo}`);
    proposals.push(db.proposals.create(candidate.tipo, payload, 'seed-sintetico'));
  }

  const channels = ['email', 'whatsapp', 'telefono'];
  for (let i = 0; i < counts.inbox; i += 1) {
    const client = clients.length ? choice(random, clients) : null;
    const [category, text, summary] = inboxTemplates[i % inboxTemplates.length];
    const urgency = category === 'incidencia' ? 2 : category === 'cita' ? 1 : 0;
    db.inbox.create({
      channel: channels[i % channels.length],
      sender: client ? (channels[i % channels.length] === 'email' ? client.email : channels[i % channels.length] === 'whatsapp' ? client.phone : client.name) : `remitente.${i + 1}@example.test`,
      text, client_id: client?.id ?? null,
      analysis: {
        answers: {
          categoria: { choice: category, probabilities: { [category]: 0.92, otro: 0.08 }, confidence: 0.92 },
          urgencia: { level: urgency, label: ['Puede esperar', 'Uno o dos días', 'Hoy'][urgency] },
          responder: { noul: 0.96 },
        },
        via: { target: 'synthetic', label: 'Generador sintético', model: 'sin-red' },
        draftVia: { target: 'synthetic', label: 'Generador sintético', model: 'sin-red' },
        summary,
        proposals: proposals.length && i % 3 === 0 ? [proposals[i % proposals.length].id] : [],
      },
    });
  }

  const statuses = ['pending', 'running', 'completed', 'failed'];
  for (let i = 0; i < counts.errands; i += 1) db.errands.create({
    agent_id: 'demo-sintetico', agent_name: 'Agente demo sintético',
    brief: `Encargo ficticio ${i + 1}: ordenar referencias de prueba sin contactar con nadie.`,
    status: statuses[i % statuses.length],
  });

  const auditKinds = ['seed_iniciado', 'dato_ficticio', 'propuesta_generada', 'encargo_sintetico', 'seed_finalizado'];
  for (let i = 0; i < counts.audit; i += 1) db.audit.add(auditKinds[i % auditKinds.length], `registro-${i + 1}`, 'Entrada sintética; no contiene datos reales ni actividad de red.');
  return counts;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const dataDir = safeDataDir(options.dataDir); // Toda comprobación ocurre antes de abrir la base.
  const db = openDb(join(dataDir, 'pyme1.db'));
  try {
    const counts = seedSynthetic(db, options);
    console.log(JSON.stringify({ total: options.count, seed: options.seed, counts }));
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
