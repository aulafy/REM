// Datos de ejemplo: se cargan una vez, no pisan datos reales sin confirmación y no ejecutan nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seedDemo, hasData } from '../src/demo.js';
import { createApp } from '../src/api.js';
import { makeSecrets } from '../src/secrets.js';

test('la demo rellena todas las pantallas y deja las propuestas pendientes de aprobar', () => {
  const db = openDb(':memory:');
  assert.equal(hasData(db), false);
  seedDemo(db);
  assert.ok(db.clients.list().length >= 6);
  assert.ok(db.tasks.list().length >= 6);
  assert.equal(db.inbox.list().length, 6);
  assert.ok(db.proposals.pending().length >= 3, 'hay propuestas esperando el sello');
  assert.ok(db.proposals.recent().some((p) => p.status === 'approved'));
  assert.ok(db.audit.list().length >= 3);
  for (const c of db.clients.list()) assert.match(c.email, /\.example$/, 'solo correos ficticios');
  db.close();
});

test('POST /api/demo exige confirmación si ya hay datos', async () => {
  const db = openDb(':memory:');
  db.clients.create({ name: 'Cliente real' });
  const app = createApp({ db, secrets: makeSecrets({ mode: 'memory' }), token: 't', staticDir: '.', getPort: () => 0 });
  const call = (body) => new Promise((resolve) => {
    const req = Object.assign(require_stream(JSON.stringify(body)), { method: 'POST', url: '/api/demo', headers: { 'x-pyme1-token': 't', host: '127.0.0.1:0', 'content-type': 'application/json' } });
    const res = { statusCode: 0, headers: {}, writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, h || {}); return this; }, setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(String(b || '{}')) }); }, once() {} };
    app(req, res);
  });
  const first = await call({});
  assert.equal(first.status, 400);
  assert.equal(db.clients.list().length, 1);
  const second = await call({ forzar: true });
  assert.equal(second.status, 200);
  assert.ok(db.clients.list().length > 1);
  db.close();
});

import { Readable } from 'node:stream';
function require_stream(text) { return Readable.from([Buffer.from(text)]); }
