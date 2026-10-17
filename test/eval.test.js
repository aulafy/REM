// El reloj y los criterios se prueban sin modelos ni datos del usuario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db.js';
import { makeSecrets } from '../src/secrets.js';
import { loadSettings, saveSettings } from '../src/settings.js';
import { askAgent } from '../src/agent.js';
import { triage } from '../src/triage.js';
import { nowDate } from '../src/clock.js';
import { checkCase, summarize } from '../scripts/eval.js';
const fixed = new Date(2026, 9, 10, 12);
function context(t, output) {
  const db = openDb(':memory:'); t.after(() => db.close()); saveSettings(db, { local: { model: 'falso' } });
  return { db, secrets: makeSecrets({ mode: 'memory' }), settings: () => loadSettings(db), now: () => fixed, providers: { chatLocal: async (_c, req) => output(req) } };
}
test('el reloj se clona y rechaza fechas inválidas', () => {
  const d = nowDate({ now: () => fixed }); d.setFullYear(2000); assert.equal(fixed.getFullYear(), 2026);
  assert.throws(() => nowDate({ now: () => 'invalida' }), /reloj/);
});
test('triage no recibe el reloj genérico sin expresión temporal', async (t) => {
  const ctx = context(t, (req) => {
    if (req.system.startsWith('Eres un clasificador')) return { text: JSON.stringify({ categoria: { opcion: 'informativo' }, urgencia: { nivel: 0 }, responder: { probabilidad: 0 } }) };
    assert.doesNotMatch(req.system, /2026-10-10/); return { text: '{"resumen":"Gracias","respuesta":""}' };
  });
  assert.equal((await triage(ctx, { text: 'Gracias' })).proposals.length, 0);
});
test('30 casos sintéticos cubren las seis familias con ocho clasificaciones', () => {
  const f = JSON.parse(readFileSync(new URL('../eval/casos.json', import.meta.url)));
  assert.equal(f.cases.length, 30); assert.equal(new Set(f.cases.map((c) => c.id)).size, 30);
  assert.equal(f.cases.filter((c) => c.type === 'clasificacion').length, 8); assert.equal(f.clients.length, 4); assert.equal(f.tasks.length, 3);
});
test('los criterios detectan cifras nuevas y una acción no solicitada', () => {
  const db = { tasks: { list: () => [1, 2, 3] }, clients: { list: () => [1, 2, 3, 4] }, proposals: { recent: () => [] }, errands: { list: () => [] } };
  const p = { kind: 'redactar_mensaje', status: 'pending', payload: { canal: 'whatsapp', asunto: '', texto: 'Son 99 euros' } };
  assert.ok(checkCase({ type: 'mensaje', text: 'Cobra 25 euros', expected: { channel: 'whatsapp' } }, { proposals: [p] }, db).some((x) => !x.ok));
  assert.ok(checkCase({ type: 'consulta', expected: { terms: [] } }, { proposals: [p] }, db).some((x) => !x.ok));
  const s = summarize([{ type: 'mensaje', passed: true, ms: 100 }, { type: 'mensaje', passed: false, ms: 500 }]);
  assert.equal(s.total.percent, 50); assert.equal(s.meanMs, 300); assert.equal(s.p90Ms, 500);
});
