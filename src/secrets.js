// Claves de API. En macOS van al Llavero; en otros sistemas, a un archivo con permisos 600.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE = 'Pyme1';

function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `exit ${code}`))));
    if (input) p.stdin.write(input);
    p.stdin.end();
  });
}

// La clave se pasa por la entrada estándar de `security -i`, no como argumento,
// para que no aparezca en la lista de procesos.
const quote = (s) => '"' + String(s).replace(/[\r\n]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function keychain() {
  const cache = new Map();
  return {
    where: 'Llavero de macOS',
    async get(name) {
      if (cache.has(name)) return cache.get(name);
      try {
        const v = (await run('security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w'])).replace(/\n$/, '');
        cache.set(name, v); return v;
      } catch { return ''; }
    },
    async set(name, value) {
      cache.delete(name);
      if (!value) { try { await run('security', ['delete-generic-password', '-s', SERVICE, '-a', name]); } catch { /* no existía */ } return; }
      await run('security', ['-i'], `add-generic-password -U -s ${quote(SERVICE)} -a ${quote(name)} -w ${quote(value)}\n`);
      cache.set(name, value);
    },
  };
}

function fileStore(dir) {
  const file = join(dir, 'secrets.json');
  const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
  return {
    where: 'archivo local protegido',
    async get(name) { return read()[name] || ''; },
    async set(name, value) {
      const all = read();
      if (value) all[name] = value; else delete all[name];
      writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
      if (existsSync(file)) chmodSync(file, 0o600);
    },
  };
}

function memoryStore() {
  const m = new Map();
  return { where: 'memoria', async get(n) { return m.get(n) || ''; }, async set(n, v) { if (v) m.set(n, v); else m.delete(n); } };
}

export function makeSecrets({ dir, mode = process.platform === 'darwin' ? 'keychain' : 'file' } = {}) {
  if (mode === 'keychain') return keychain();
  if (mode === 'memory') return memoryStore();
  return fileStore(dir);
}
