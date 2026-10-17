import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.js';
import { createBackups } from '../src/backups.js';
import { createServer } from 'node:http';
import { createApp } from '../src/api.js';
import { makeSecrets } from '../src/secrets.js';
function fixture(t, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pyme1-copias-'));
  const db = openDb(join(dir, 'pyme1.db'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, db, backups: createBackups({ db, dataDir: dir, ...opts }) };
}
test('VACUUM INTO copia datos aún en WAL y el mismo día reemplaza sin perder datos', (t) => {
  const f = fixture(t, { now: () => new Date(2026, 9, 10, 12) });
  f.db.clients.create({ name: 'Sintético uno' });
  let status = f.backups.create(); assert.equal(status.count, 1); assert.match(status.last.name, /2026-10-10/);
  let copy = openDb(status.last.path); assert.equal(copy.clients.list().length, 1); copy.close();
  f.db.clients.create({ name: 'Sintético dos' }); status = f.backups.create();
  assert.equal(status.count, 1); copy = openDb(status.last.path); assert.equal(copy.clients.list().length, 2); copy.close();
  assert.equal(readdirSync(join(f.dir, 'copias')).filter((n) => n.startsWith('.copia-')).length, 0);
});
test('conserva las 14 últimas fechas y no elimina otros archivos', (t) => {
  let day = 1; const f = fixture(t, { now: () => new Date(2026, 9, day, 12) });
  f.backups.create(); writeFileSync(join(f.dir, 'copias', 'nota.txt'), 'no es una copia');
  for (day = 2; day <= 20; day++) f.backups.create();
  const names = readdirSync(join(f.dir, 'copias')); assert.equal(names.filter((n) => n.endsWith('.db')).length, 14);
  assert.ok(names.includes('pyme1-2026-10-07.db')); assert.ok(!names.includes('pyme1-2026-10-06.db')); assert.ok(names.includes('nota.txt'));
});
test('un fallo conserva la copia anterior y no deja un archivo incompleto', (t) => {
  const f = fixture(t); const path = f.backups.create().last.path, before = readFileSync(path);
  f.db.backupTo = (path) => { writeFileSync(path, 'incompleta'); throw new Error('disco lleno'); };
  assert.throws(() => f.backups.create(), /No se ha podido/);
  assert.deepEqual(readFileSync(path), before); assert.ok(f.backups.status().error);
  assert.equal(readdirSync(join(f.dir, 'copias')).filter((n) => n.startsWith('.copia-')).length, 0);
});
test('arranca una vez, programa cada 24 h, informa fallos y detiene el temporizador', (t) => {
  let callback, period, scheduled = 0, cancelled = 0;
  const timer = { unref() {} };
  const f = fixture(t, { every: (fn, ms) => { callback = fn; period = ms; scheduled++; return timer; }, cancel: (x) => { assert.equal(x, timer); cancelled++; } });
  f.backups.start(); f.backups.start(); assert.equal(scheduled, 1); assert.equal(period, 86400000); assert.equal(f.backups.status().count, 1);
  f.db.backupTo = () => { throw new Error('fallo sintético'); }; callback(); assert.ok(f.backups.status().error);
  f.backups.stop(); f.backups.stop(); assert.equal(cancelled, 1);
});
test('Mostrar en Finder rechaza escapes, archivo de datos y enlaces fuera del almacén', async (t) => {
  const seen = [], f = fixture(t, { reveal: async (path) => seen.push(path) }); const path = f.backups.create().last.path;
  await f.backups.show(); assert.deepEqual(seen, [path]);
  for (const bad of ['/etc/passwd', join(f.dir, 'pyme1.db'), join(f.dir, 'copias', '..', 'pyme1.db'), join(f.dir, 'copias', 'ausente.db')]) await assert.rejects(f.backups.show(bad));
  symlinkSync('/etc/passwd', join(f.dir, 'copias', 'pyme1-2026-01-01.db'));
  await assert.rejects(f.backups.show(join(f.dir, 'copias', 'pyme1-2026-01-01.db')), /ruta/); assert.equal(seen.length, 1);
});
test('rechaza la carpeta copias si se sustituye por un enlace', (t) => {
  const f = fixture(t), outside = mkdtempSync(join(tmpdir(), 'pyme1-outside-')); t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(f.dir, 'copias')); assert.throws(() => f.backups.create(), /enlace/); assert.equal(readdirSync(outside).length, 0);
});
test('API de copias exige token/origen y solo revela la copia validada', async (t) => {
  let shown = ''; const f = fixture(t, { reveal: async (path) => shown = path }); let port;
  const server = createServer(createApp({ db: f.db, secrets: makeSecrets({ mode: 'memory' }), token: 'sintetico', staticDir: 'public', getPort: () => port, backups: f.backups }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port; t.after(() => server.close());
  const call = (path, body, headers = {}) => fetch(`http://127.0.0.1:${port}/api/backups${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-pyme1-token': 'sintetico', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await call('', undefined, { 'x-pyme1-token': '' })).status, 401);
  assert.equal((await call('', {}, { origin: 'https://ajeno.invalid' })).status, 403);
  const backup = await (await call('', {})).json(); assert.equal(backup.count, 1);
  assert.equal((await call('/reveal', { path: '/etc/passwd' })).status, 400); assert.equal(shown, '');
  assert.equal((await call('/reveal', {})).status, 200); assert.equal(shown, backup.last.path);
});
test('experimental backup status states its limited scope; no complete AWOS recovery is claimed',async t=>{
 const f=fixture(t);let port;const server=createServer(createApp({db:f.db,secrets:makeSecrets({mode:'memory'}),token:'sintetico',staticDir:'public',getPort:()=>port,backups:f.backups,awos:{}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;t.after(()=>server.close());
 for(const method of ['GET','POST']){const r=await fetch(`http://127.0.0.1:${port}/api/backups`,{method,headers:{'x-pyme1-token':'sintetico','content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(r.status,200);const data=await r.json();assert.equal(data.scope,'pyme1-only');assert.match(data.notice,/solo incluye REM/);assert.match(data.notice,/conjunta con AWOS/);}
});
