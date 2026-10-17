// Seguridad del servidor local y un flujo completo por HTTP con un Ollama simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { makeSecrets } from '../src/secrets.js';
import { createApp } from '../src/api.js';

const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function start(overrides) {
  const db = openDb(':memory:');
  let port = 0;
  const server = createServer(createApp({ db, secrets: makeSecrets({ mode: 'memory' }), token: 'tok', staticDir, getPort: () => port, overrides }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = (path, { method = 'GET', body, token = 'tok', headers = {} } = {}) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-pyme1-token': token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
  });
  return { db, base, call, close: () => server.close() };
}

test('la API exige el token y rechaza otros orígenes', async () => {
  const s = await start();
  assert.equal((await s.call('/api/state', { token: '' })).status, 401);
  assert.equal((await s.call('/api/state', { token: 'mal' })).status, 401);
  assert.equal((await s.call('/api/clients', { method: 'POST', body: { name: 'x' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await s.call('/api/state')).status, 200);
  s.close();
});

test('la página incluye el token y una política de seguridad estricta', async () => {
  const s = await start();
  const r = await fetch(`${s.base}/`);
  const html = await r.text();
  assert.match(html, /content="tok"/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(`${s.base}/../src/db.js`)).status, 404);
  s.close();
});

test('flujo completo: ajustes, asistente, aprobación y tarea creada', async () => {
  // Ollama simulado
  const ollama = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const b = JSON.parse(body || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'modelo-prueba:7b', size: 1 }] }));
    assert.equal(b.model, 'modelo-prueba:7b');
    res.end(JSON.stringify({ message: { content: JSON.stringify({ respuesta: 'Te apunto la llamada.', acciones: [{ tipo: 'crear_tarea', titulo: 'Llamar a Marta', fecha: '2026-10-12', cliente: 'Marta Ruiz' }] }) } }));
  });
  await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
  const s = await start();
  const ourl = `http://127.0.0.1:${ollama.address().port}`;

  await s.call('/api/settings', { method: 'POST', body: { local: { url: ourl, enabled: true } } });
  const models = await (await s.call('/api/models/local')).json();
  assert.deepEqual(models.map((m) => m.id), ['modelo-prueba:7b']);
  await s.call('/api/settings', { method: 'POST', body: { local: { model: 'modelo-prueba:7b' } } });
  await s.call('/api/clients', { method: 'POST', body: { name: 'Marta Ruiz' } });

  const chat = await (await s.call('/api/chat', { method: 'POST', body: { text: 'Recuérdame llamar a Marta el lunes' } })).json();
  assert.equal(chat.message.content, 'Te apunto la llamada.');
  assert.equal(chat.message.meta.via.target, 'local');
  const pid = chat.proposals[0].id;

  let state = await (await s.call('/api/state')).json();
  assert.equal(state.tasks.length, 0);
  assert.equal(state.pending.length, 1);
  assert.ok(state.chatProposals[pid]);

  const ok = await (await s.call(`/api/proposals/${pid}/approve`, { method: 'POST', body: { payload: { titulo: 'Llamar a Marta por la renovación' } } })).json();
  assert.equal(ok.status, 'approved');
  state = await (await s.call('/api/state')).json();
  assert.equal(state.tasks[0].title, 'Llamar a Marta por la renovación');
  assert.equal(state.tasks[0].client_name, 'Marta Ruiz');
  const audit = await (await s.call('/api/audit')).json();
  assert.equal(audit.length, 0, 'con IA local no sale nada del Mac');

  s.close(); ollama.close();
});

test('errores de configuración llegan con un mensaje claro', async () => {
  const s = await start();
  const r = await s.call('/api/chat', { method: 'POST', body: { text: 'hola' } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).message, /IA local no está configurada/);
  const bad = await s.call('/api/settings', { method: 'POST', body: { local: { url: 'ftp://x' } } });
  assert.equal(bad.status, 400);
  s.close();
});
