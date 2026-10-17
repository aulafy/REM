// Evaluación reproducible: solo Ollama, datos sintéticos y ninguna aprobación.
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { makeSecrets } from '../src/secrets.js';
import { loadSettings, saveSettings } from '../src/settings.js';
import { askAgent, resolveDate } from '../src/agent.js';
import { triage } from '../src/triage.js';
import { chatLocal } from '../src/ai/providers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { numbers, unexpectedNumbers } from '../src/numbers.js';
export { numbers };
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function checkCase(c, result, db, fixture = {}) {
  const checks = [], ps = result.proposals || [];
  const check = (name, ok) => checks.push({ name, ok: !!ok });
  const ofKind = (k) => ps.filter((p) => p.kind === k).map((p) => p.payload);
  const e = c.expected;
  if (c.type === 'tarea') check('tarea con fecha exacta', ofKind('crear_tarea').some((p) => p.fecha === e.date));
  if (c.type === 'mensaje') {
    const msgs = ofKind('redactar_mensaje');
    check('canal y texto', msgs.length > 0 && msgs.every((p) => p.canal === e.channel && p.texto.trim()));
    const date = resolveDate(c.text, new Date(fixture.clock || '2026-10-10T12:00:00+02:00'));
    check('sin cifras inventadas', msgs.every((p) => unexpectedNumbers(c.text, p, date, db.clients.findByName?.(p.cliente)).length === 0));
  }
  if (c.type === 'cliente') check('contacto exacto', ofKind('crear_cliente').some((p) => fold(p.nombre) === fold(e.name) && ['email', 'telefono'].every((k) => e[k] === undefined || p[k] === e[k])));
  if (c.type === 'nota') check('nota al cliente correcto', ofKind('anadir_nota').some((p) => db.clients.findByName(p.cliente)?.name === e.client && p.texto.trim()));
  if (c.type === 'consulta') {
    check('ninguna acción', ps.length === 0);
    check('respuesta contextual', (e.terms || []).every((term) => fold(result.message?.content).includes(fold(term))));
  }
  if (c.type === 'clasificacion') {
    check('categoría', result.answers?.categoria?.choice === e.category);
    const needsReply = result.answers?.responder?.noul >= .5 && result.answers?.categoria?.choice !== 'informativo';
    check('necesidad de respuesta', needsReply === e.reply);
    if (!e.reply) check('sin borrador innecesario', ofKind('redactar_mensaje').length === 0);
  }
  check('no ejecuta tareas ni clientes', (db.tasks.list().length === (fixture.tasks?.length ?? 3)) && (db.clients.list().length === (fixture.clients?.length ?? 4)) && db.clients.list().every((client) => !client.notes));
  check('todo pendiente', ps.every((p) => p.status === 'pending') && db.proposals.recent().length === 0 && db.errands.list().length === 0);
  return checks;
}
export function summarize(rows) {
  const repeats = [...new Set(rows.map((r) => r.repetition || 1))];
  const group = (items) => {
    const percent = (rs) => rs.length ? 100 * rs.filter((r) => r.passed).length / rs.length : 0;
    const scores = repeats.map((n) => percent(items.filter((r) => (r.repetition || 1) === n)));
    return { cases: items.length, passed: items.filter((r) => r.passed).length, percent: +percent(items).toFixed(1), meanPercent: +(scores.reduce((a,b) => a+b,0) / (scores.length || 1)).toFixed(1), minPercent: +Math.min(...scores, ...(scores.length ? [] : [0])).toFixed(1) };
  };
  const latencies = rows.map((r) => r.ms).sort((a, b) => a - b);
  return { types: Object.fromEntries([...new Set(rows.map((r) => r.type))].map((type) => [type, group(rows.filter((r) => r.type === type))])), total: group(rows), meanMs: Math.round(latencies.reduce((a, b) => a + b, 0) / (rows.length || 1)), p90Ms: Math.round(latencies[Math.max(0, Math.ceil(rows.length * .9) - 1)] || 0) };
}
export function loadFixture(casesFile = 'eval/casos.json') {
  const source = readFileSync(resolve(root, casesFile), 'utf8');
  const defaults = JSON.parse(readFileSync(join(root, 'eval/casos.json'), 'utf8'));
  const fixture = { ...defaults, ...JSON.parse(source) };
  if (!Array.isArray(fixture.cases) || !fixture.cases.length || new Set(fixture.cases.map((c) => c.id)).size !== fixture.cases.length) throw new Error('Los casos necesitan identificadores únicos y una lista no vacía.');
  if (!Number.isFinite(new Date(fixture.clock).getTime()) || !Array.isArray(fixture.clients) || !Array.isArray(fixture.tasks)) throw new Error('El fixture necesita un reloj, clientes y tareas válidos.');
  return { source, fixture, fixtureSha256: createHash('sha256').update(JSON.stringify(fixture)).digest('hex') };
}
export function parseArgs(args) {
  const options = { casesFile: 'eval/casos.json', rules: true, repetitions: 1 };
  const names = { '--model': 'model', '--url': 'url', '--label': 'label', '--casos': 'casesFile', '--repeticiones': 'repetitions' };
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--sin-reglas') { options.rules = false; continue; }
    const name = names[args[i]];
    if (!name || !args[i+1] || args[i+1].startsWith('--')) throw new Error(`Argumento no válido: ${args[i]}`);
    options[name] = args[++i];
  }
  options.repetitions = Number(options.repetitions);
  if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1 || options.repetitions > 100) throw new Error('--repeticiones debe ser un entero entre 1 y 100.');
  return options;
}
export async function evaluate({ model, url = 'http://127.0.0.1:11434', label = 'baseline', casesFile = 'eval/casos.json', rules = true, repetitions = 1, provider = chatLocal, resultsDir = join(root, 'eval/results') }) {
  if (!model) throw new Error('Indica --model con el nombre exacto de un modelo de Ollama.');
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('Número de repeticiones no válido.');
  const { source: casesSource, fixture, fixtureSha256 } = loadFixture(casesFile);
  process.env.TZ = fixture.timezone;
  const dir = mkdtempSync(join(tmpdir(), 'pyme1-eval-'));
  const rows = [];
  let gitSha = ''; try { gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* Sin Git: queda indicado. */ }
  const startedAt = new Date().toISOString();
  const codeHashes = Object.fromEntries(['src/agent.js', 'src/draft-context.js', 'src/draft-dates.js', 'src/clock.js', 'src/intents.js', 'src/triage.js', 'src/ai/router.js', 'src/ai/providers.js', 'src/ai/decision.js', 'src/numbers.js', 'src/dates.js', 'scripts/eval.js'].map((file) => { try { return [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]; } catch { return [file, null]; } }));
  try {
    for (let repetition = 1; repetition <= repetitions; repetition++) for (const c of fixture.cases) {
      const db = openDb(join(dir, `${repetition}-${c.id}.db`));
      fixture.clients.forEach((x) => db.clients.create(x)); fixture.tasks.forEach((x) => db.tasks.create(x));
      saveSettings(db, { local: { enabled: true, url, model }, external: { enabled: false }, privacy: 'local-only', routing: { chat: 'local', draft: 'local', triage: 'local' } });
      const calls = [], start = performance.now(); let result = null, error = null;
      const ctx = { rules, db, secrets: makeSecrets({ mode: 'memory' }), settings: () => loadSettings(db), now: () => new Date(fixture.clock), providers: {
        chatLocal: async (cfg, req) => { const begin = performance.now(); try { const r = await provider(cfg, req); calls.push({ raw: r.text, ms: performance.now() - begin, request: req }); return r; } catch (e) { calls.push({ error: e.code || e.message, ms: performance.now() - begin }); throw e; } },
        chatExternal: async () => { throw new Error('La evaluación prohíbe proveedores externos.'); },
      } };
      try { result = c.type === 'clasificacion' ? await triage(ctx, c) : await askAgent(ctx, c.text, { prefer: 'local' }); }
      catch (e) { error = { code: e.code || 'ERROR', message: e.message }; }
      const checks = result ? checkCase(c, result, db, fixture) : [{ name: 'respuesta sin error', ok: false }];
      const row = { ...c, repetition, ms: Math.round(performance.now() - start), passed: checks.every((x) => x.ok), checks, result, calls, error }; rows.push(row);
      db.close();
      console.log(`${c.id.padEnd(19)} ${row.passed ? 'OK' : 'FALLO'} ${(row.ms / 1000).toFixed(1)} s${row.passed ? '' : ' · ' + checks.filter((x) => !x.ok).map((x) => x.name).join(', ')}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const summary = summarize(rows);
  const output = { model, url, label, rules, repetitions, casesFile: resolve(root, casesFile), fixtureSha256, startedAt, completedAt: new Date().toISOString(), gitSha, codeHashes, node: process.version, platform: process.platform, clock: fixture.clock, timezone: fixture.timezone, casesSha256: createHash('sha256').update(casesSource).digest('hex'), summary, rows };
  mkdirSync(resultsDir, { recursive: true });
  const path = join(resultsDir, `${startedAt.replace(/[:.]/g, '-')}-${model.replace(/[^\w.-]/g, '_')}-${label.replace(/[^\w.-]/g, '_')}-${rules ? 'reglas' : 'sin-reglas'}.json`);
  writeFileSync(path, JSON.stringify(output, null, 2) + '\n', { mode: 0o600 });
  console.table(Object.entries(summary.types).map(([type, r]) => ({ tipo: type, aciertos: `${r.passed}/${r.cases}`, porcentaje: r.meanPercent, minimo: r.minPercent })));
  console.log(`Total: ${summary.total.passed}/${summary.total.cases} (${summary.total.percent}%). Mínimo: ${summary.total.minPercent}%. Repeticiones: ${repetitions}. Media: ${summary.meanMs} ms; p90: ${summary.p90Ms} ms.\nResultados: ${path}`);
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { evaluate(parseArgs(process.argv.slice(2))).catch((e) => { console.error(e.message); process.exitCode = 1; }); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
