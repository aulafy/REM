// Almacén local: un único archivo SQLite (node:sqlite, sin dependencias).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {createProposalTemplates} from './proposal-templates.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT DEFAULT '', phone TEXT DEFAULT '',
  notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, due TEXT DEFAULT '',
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat (
  id INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', result TEXT DEFAULT '', created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY, channel TEXT, sender TEXT, text TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL, analysis TEXT DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS errands (
  id INTEGER PRIMARY KEY, agent_id TEXT NOT NULL, agent_name TEXT NOT NULL, brief TEXT NOT NULL,
  status TEXT NOT NULL, remote_id TEXT DEFAULT '', response TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, target TEXT DEFAULT '', detail TEXT DEFAULT '');
`;

const now = () => new Date().toISOString();
const plain = (row) => (row ? { ...row } : row);
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const q = (sql) => db.prepare(sql);
  const id = (r) => Number(r.lastInsertRowid);

  const clients = {
    list: () => q('SELECT * FROM clients ORDER BY name COLLATE NOCASE').all().map(plain),
    get: (cid) => plain(q('SELECT * FROM clients WHERE id = ?').get(cid)),
    create({ name, email = '', phone = '', notes = '' }) {
      const t = now();
      return clients.get(id(q('INSERT INTO clients (name,email,phone,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(String(name).trim(), email, phone, notes, t, t)));
    },
    update(cid, f) {
      const c = clients.get(cid); if (!c) return null;
      q('UPDATE clients SET name=?, email=?, phone=?, notes=?, updated_at=? WHERE id=?')
        .run(f.name ?? c.name, f.email ?? c.email, f.phone ?? c.phone, f.notes ?? c.notes, now(), cid);
      return clients.get(cid);
    },
    remove: (cid) => q('DELETE FROM clients WHERE id = ?').run(cid).changes > 0,
    // Busca por nombre: exacto, luego "empieza por", luego "contiene". Solo devuelve si es único.
    findByName(name) {
      const n = String(name || '').trim().toLowerCase(); if (!n) return null;
      const all = clients.list();
      for (const test of [(c) => c.name.toLowerCase() === n, (c) => c.name.toLowerCase().startsWith(n), (c) => c.name.toLowerCase().includes(n)]) {
        const found = all.filter(test);
        if (found.length === 1) return found[0];
        if (found.length > 1) return null;
      }
      return null;
    },
  };

  const tasks = {
    list: () => q(`SELECT t.*, c.name AS client_name FROM tasks t LEFT JOIN clients c ON c.id = t.client_id
                   ORDER BY t.done, CASE WHEN t.due = '' THEN 1 ELSE 0 END, t.due, t.id DESC`).all().map(plain),
    get: (tid) => plain(q('SELECT * FROM tasks WHERE id = ?').get(tid)),
    create({ title, due = '', client_id = null }) {
      return tasks.get(id(q('INSERT INTO tasks (title,due,client_id,created_at) VALUES (?,?,?,?)')
        .run(String(title).trim(), due || '', client_id, now())));
    },
    setDone: (tid, done) => q('UPDATE tasks SET done = ? WHERE id = ?').run(done ? 1 : 0, tid).changes > 0,
    remove: (tid) => q('DELETE FROM tasks WHERE id = ?').run(tid).changes > 0,
  };

  const chat = {
    list: (limit = 60) => q('SELECT * FROM (SELECT * FROM chat ORDER BY id DESC LIMIT ?) ORDER BY id').all(limit)
      .map((r) => ({ ...r, meta: parse(r.meta, {}) })),
    add: (role, content, meta = {}) => id(q('INSERT INTO chat (role,content,meta,created_at) VALUES (?,?,?,?)')
      .run(role, content, JSON.stringify(meta), now())),
    clear: () => q('DELETE FROM chat').run(),
  };

  const rowProposal = (r) => r && ({ ...r, payload: parse(r.payload, {}), result: parse(r.result, null) });
  const proposals = {
    create: (kind, payload, source) => proposals.get(id(q('INSERT INTO proposals (kind,payload,source,created_at) VALUES (?,?,?,?)')
      .run(kind, JSON.stringify(payload), source, now()))),
    get: (pid) => rowProposal(plain(q('SELECT * FROM proposals WHERE id = ?').get(pid))),
    pending: () => q("SELECT * FROM proposals WHERE status = 'pending' ORDER BY id DESC").all().map((r) => rowProposal(plain(r))),
    recent: (limit = 20) => q("SELECT * FROM proposals WHERE status != 'pending' ORDER BY decided_at DESC LIMIT ?").all(limit).map((r) => rowProposal(plain(r))),
    decide(pid, status, payload, result) {
      q('UPDATE proposals SET status=?, payload=?, result=?, decided_at=? WHERE id=?')
        .run(status, JSON.stringify(payload), JSON.stringify(result ?? null), now(), pid);
      return proposals.get(pid);
    },
  };

  const inbox = {
    create: ({ channel, sender, text, client_id = null, analysis }) => id(q('INSERT INTO inbox (channel,sender,text,client_id,analysis,created_at) VALUES (?,?,?,?,?,?)')
      .run(channel || 'otro', sender || '', text, client_id, JSON.stringify(analysis || {}), now())),
    list: (limit = 30) => q('SELECT * FROM inbox ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ ...r, analysis: parse(r.analysis, {}) })),
  };

  const errands = {
    create({ agent_id, agent_name, brief, status }) {
      const t = now();
      return errands.get(id(q('INSERT INTO errands (agent_id,agent_name,brief,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
        .run(agent_id, agent_name, brief, status, t, t)));
    },
    get: (eid) => plain(q('SELECT * FROM errands WHERE id = ?').get(eid)),
    list: () => q('SELECT * FROM errands ORDER BY id DESC').all().map(plain),
    update(eid, f) {
      const e = errands.get(eid); if (!e) return null;
      q('UPDATE errands SET status=?, remote_id=?, response=?, updated_at=? WHERE id=?')
        .run(f.status ?? e.status, f.remote_id ?? e.remote_id, f.response ?? e.response, now(), eid);
      return errands.get(eid);
    },
  };

  const audit = {
    add: (kind, target = '', detail = '') => q('INSERT INTO audit (at,kind,target,detail) VALUES (?,?,?,?)').run(now(), kind, target, detail),
    list: (limit = 100) => q('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit).map(plain),
  };

  const proposalTemplates=createProposalTemplates({run:(sql,...params)=>q(sql).run(...params),all:(sql,...params)=>q(sql).all(...params).map(plain)});

  return {
    clients, tasks, chat, proposals, inbox, errands, audit, proposalTemplates,
    getSetting(key, fallback) { const r = q('SELECT value FROM settings WHERE key = ?').get(key); return r ? parse(r.value, fallback) : fallback; },
    setSetting(key, value) { q('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); },
    // VACUUM INTO produce una instantánea consistente incluso con WAL activo.
    backupTo: (target) => q('VACUUM INTO ?').run(target),
    // Solo para utilidades internas (datos de ejemplo): consultas con parámetros, nunca texto de usuario.
    run: (sql, ...params) => q(sql).run(...params),
    all: (sql, ...params) => q(sql).all(...params).map(plain),
    close: () => db.close(),
  };
}
