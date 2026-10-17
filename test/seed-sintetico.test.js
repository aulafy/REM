import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDb } from '../src/db.js';
import { ACTION_TYPES, normalizeAction } from '../src/agent.js';

const script = join(process.cwd(), 'scripts', 'seed-sintetico.js');
const roots = [];
const temporary = (prefix = 'pyme1-seed-') => { const dir = mkdtempSync(join(tmpdir(), prefix)); roots.push(dir); return dir; };
test.after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const run = (dir, count = 100, seed = 42) => spawnSync(process.execPath, [script, '--data-dir', dir, '--count', String(count), '--seed', String(seed)], { encoding: 'utf8' });

test('rechaza una carpeta fuera de tmp sin escribir', () => {
  const dir = process.cwd();
  const unexpected = join(dir, 'pyme1.db');
  const existed = existsSync(unexpected);
  const result = run(dir, 1, 1);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /carpeta temporal/);
  assert.equal(existsSync(unexpected), existed);
});

test('crea exactamente --count registros con el reparto solicitado', () => {
  const dir = temporary();
  const result = run(dir, 100, 42);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary.counts, { clients: 30, tasks: 25, inbox: 20, proposals: 15, errands: 5, audit: 5 });
  const db = openDb(join(dir, 'pyme1.db'));
  const total = ['clients', 'tasks', 'inbox', 'proposals', 'errands', 'audit']
    .reduce((sum, table) => sum + Number(db.all(`SELECT count(*) AS n FROM ${table}`)[0].n), 0);
  assert.equal(total, 100);
  assert.equal(Number(db.all('SELECT count(*) AS n FROM proposal_templates')[0].n),3);
  db.close();
});

function snapshot(dir) {
  const db = openDb(join(dir, 'pyme1.db'));
  const rows = {
    clients: db.all('SELECT name,email,phone,notes FROM clients ORDER BY id'),
    tasks: db.all('SELECT title,due,client_id,done FROM tasks ORDER BY id'),
    inbox: db.all('SELECT channel,sender,text,client_id,analysis FROM inbox ORDER BY id'),
    proposals: db.all('SELECT kind,payload,source,status FROM proposals ORDER BY id'),
    errands: db.all('SELECT agent_id,agent_name,brief,status FROM errands ORDER BY id'),
    audit: db.all('SELECT kind,target,detail FROM audit ORDER BY id'),
    templates: db.all('SELECT id,nombre,asunto,cuerpo,version FROM proposal_templates ORDER BY id'),
  };
  db.close();
  return rows;
}

test('la misma semilla produce el mismo contenido', () => {
  const a = temporary('pyme1-seed-a-');
  const b = temporary('pyme1-seed-b-');
  assert.equal(run(a, 73, 9182).status, 0);
  assert.equal(run(b, 73, 9182).status, 0);
  assert.deepEqual(snapshot(a), snapshot(b));
});

test('todas las propuestas tienen tipos y payloads aceptados por normalizeAction', () => {
  const dir = temporary();
  const result = run(dir, 100, 7);
  assert.equal(result.status, 0, result.stderr);
  const db = openDb(join(dir, 'pyme1.db'));
  for (const proposal of db.proposals.pending()) {
    assert.ok(ACTION_TYPES.includes(proposal.kind));
    assert.notEqual(proposal.kind, 'encargar');
    assert.ok(normalizeAction({ tipo: proposal.kind, ...proposal.payload }), proposal.kind);
  }
  db.close();
});
