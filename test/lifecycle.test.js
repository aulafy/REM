// Todos los procesos usan un almacén temporal y el puerto QA, nunca el piloto.
import { test } from 'node:test';
import {freePort} from './helpers/free-port.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { openDb } from '../src/db.js';
import { makeSecrets } from '../src/secrets.js';
import { createApp } from '../src/api.js';

async function occupiedPortWithFreeSuccessor() {
  for (;;) {
    const occupied = createServer((_r, res) => res.end('ajeno'));
    await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(0, '127.0.0.1', resolve); });
    const port = occupied.address().port;
    if (port < 65535) {
      const probe = createServer();
      try {
        await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port + 1, '127.0.0.1', resolve); });
        await new Promise((resolve) => probe.close(resolve));
        return { occupied, port };
      } catch {}
    }
    await new Promise((resolve) => occupied.close(resolve));
  }
}
async function launch(t, dir, port, {observePorts=false}={}) {
  port ??= await freePort();
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...(observePorts?['--import','./test/helpers/observe-listens.mjs']:[]), 'src/server.js'], { env: { ...process.env, PYME1_DATA_DIR: dir, PYME1_SECRETS: 'memory', PYME1_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (p.exitCode === null) p.kill('SIGTERM'); });
  const closed = once(p, 'exit'); let output = '';
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No arrancó el servidor QA.')), 5000);
    p.stdout.on('data', (d) => { output += d; const m = output.match(/REM está funcionando en (http:\/\/127\.0\.0\.1:\d+\/)/); if (m) { clearTimeout(timeout); resolve(m[1]); } });
    p.on('error', (e) => { clearTimeout(timeout); reject(e); }); p.on('exit', () => { clearTimeout(timeout); reject(new Error('El servidor terminó antes de arrancar.')); });
  });
  const html = await (await fetch(url)).text(); const token = html.match(/name="pyme1-token" content="([^"]+)"/)[1];
  const call = (path, body, key = token) => fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-pyme1-token': key, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { p, url, token, call, closed, listenTrace:()=>output.split('\n').filter(line=>line.startsWith('QA_LISTEN ')).map(line=>JSON.parse(line.slice(10))) };
}
test('cierre autenticado responde, detiene solo el servidor QA y conserva datos tras reinicio', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pyme1-lifecycle-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = await launch(t, dir);
  assert.equal((await s.call('api/shutdown', {}, 'incorrecto')).status, 401);
  assert.equal((await s.call('api/state')).status, 200);
  const marker = (await fetch(s.url)).headers.get('x-pyme1-instance'); assert.match(marker, /^[a-f0-9]{64}$/);
  await s.call('api/clients', { name: 'Cliente sintético' });
  const r = await s.call('api/shutdown', {}); assert.equal(r.status, 200); assert.equal((await r.json()).ok, true);
  const [code] = await s.closed; assert.equal(code, 0);
  await assert.rejects(fetch(s.url));
  const restarted = await launch(t, dir); assert.notEqual(restarted.token, s.token);
  assert.equal((await restarted.call('api/state')).status, 200);
  assert.equal((await (await restarted.call('api/state')).json()).clients[0].name, 'Cliente sintético');
  assert.equal((await fetch(restarted.url)).headers.get('x-pyme1-instance'), marker);
  restarted.p.kill('SIGTERM'); assert.equal((await restarted.closed)[0], 0);
});
test('si el puerto QA está ocupado, prueba los siguientes en orden sin detener al ocupante', async (t) => {
  const { occupied, port } = await occupiedPortWithFreeSuccessor();
  t.after(() => occupied.close());
  const dir = mkdtempSync(join(tmpdir(), 'pyme1-port-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = await launch(t, dir, port, {observePorts:true}),actual=Number(new URL(s.url).port),trace=s.listenTrace();
  // The initial free probe is not a lease: other parallel tests (including
  // outgoing ephemeral sockets) may take its successor before the child binds.
  // Require every actual skip to be sequential AND backed by EADDRINUSE.
  assert.ok(actual>port&&actual<=port+10);
  assert.deepEqual(trace.filter(e=>e.kind==='attempt').map(e=>e.port),Array.from({length:actual-port+1},(_,i)=>port+i));
  assert.deepEqual(trace.filter(e=>e.kind==='error'),Array.from({length:actual-port},(_,i)=>({kind:'error',port:port+i,code:'EADDRINUSE'})));
  s.p.kill('SIGINT'); await s.closed;
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ajeno');
});
test('cierre mantiene protección de origen y método, y se invoca después de responder', async (t) => {
  const db = openDb(':memory:'); t.after(() => db.close()); let port, stopped = 0;
  const server = createServer(createApp({ db, secrets: makeSecrets({ mode: 'memory' }), token: 'sintetico', staticDir: 'public', getPort: () => port, onShutdown: () => stopped++ }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port; t.after(() => server.close());
  const call = (method, headers = {}) => fetch(`http://127.0.0.1:${port}/api/shutdown`, { method, headers: { 'x-pyme1-token': 'sintetico', ...headers } });
  assert.equal((await call('GET')).status, 404);
  assert.equal((await call('POST', { origin: 'https://ajeno.invalid' })).status, 403); assert.equal(stopped, 0);
  assert.equal((await call('POST')).status, 200); await delay(10); assert.equal(stopped, 1);
});
