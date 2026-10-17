// Instantáneas SQLite locales. No copia secretos ni permite abrir rutas arbitrarias.
import { mkdirSync, realpathSync, lstatSync, readdirSync, renameSync, unlinkSync, chmodSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ValidationError } from './settings.js';
const run = promisify(execFile);
const FILE = /^pyme1-\d{4}-\d{2}-\d{2}\.db$/;
const DAILY = 24 * 60 * 60 * 1000;
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function createBackups({ db, dataDir, now = () => new Date(), reveal = (path) => run('/usr/bin/open', ['-R', path]), every = setInterval, cancel = clearInterval }) {
  const root = realpathSync(dataDir), folder = join(root, 'copias');
  let timer = null, error = null;
  function ensureFolder() {
    if (realpathSync(dataDir) !== root) throw new ValidationError('La carpeta de datos ha cambiado. Reinicia REM.');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (lstatSync(folder).isSymbolicLink() || realpathSync(folder) !== folder) throw new ValidationError('La carpeta de copias no puede ser un enlace.');
    chmodSync(folder, 0o700);
  }
  function files() {
    ensureFolder();
    return readdirSync(folder).filter((name) => FILE.test(name)).flatMap((name) => {
      const path = join(folder, name), stat = lstatSync(path);
      return stat.isFile() && !stat.isSymbolicLink() ? [{ name, path, at: stat.mtime.toISOString() }] : [];
    }).sort((a, b) => b.name.localeCompare(a.name));
  }
  function status() {
    try { const rows = files(); return { last: rows[0] || null, count: rows.length, retention: 14, error }; }
    catch { return { last: null, count: 0, retention: 14, error: 'No se puede acceder a las copias. Revisa los permisos de la carpeta de datos.' }; }
  }
  function create() {
    ensureFolder();
    const name = `pyme1-${isoDay(new Date(now()))}.db`, target = join(folder, name);
    try { if (lstatSync(target).isSymbolicLink()) throw new ValidationError('La copia existente no puede ser un enlace.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const temp = join(folder, `.copia-${randomUUID()}.db`);
    try {
      db.backupTo(temp); chmodSync(temp, 0o600);
      const fd = openSync(temp, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, target);
      // La copia del día se reemplaza de forma atómica; si falla, la anterior sigue intacta.
      const fdDir = openSync(folder, 'r'); try { fsyncSync(fdDir); } finally { closeSync(fdDir); }
      for (const old of files().slice(14)) unlinkSync(old.path);
      error = null;
      return status();
    } catch (e) {
      try { unlinkSync(temp); } catch { /* Ya movida o no creada. */ }
      error = 'No se ha podido hacer la copia. Revisa el espacio libre y los permisos.';
      throw new ValidationError(error);
    }
  }
  async function show(path) {
    ensureFolder();
    const target = resolve(path || status().last?.path || '');
    let parent; try { parent = realpathSync(dirname(target)); } catch { parent = ''; }
    if (parent !== folder || !FILE.test(basename(target))) throw new ValidationError('Solo se pueden mostrar copias de REM dentro de su carpeta de datos.');
    let stat;
    try { stat = lstatSync(target); } catch { throw new ValidationError('La copia no existe.'); }
    if (!stat.isFile() || stat.isSymbolicLink() || dirname(realpathSync(target)) !== folder) throw new ValidationError('La ruta de la copia no es válida.');
    await reveal(realpathSync(target)); return { ok: true };
  }
  const automatic = () => { try { create(); } catch { error ||= 'No se ha podido hacer la copia automática.'; } };
  return {
    status, create, show,
    start() { if (timer !== null) return; automatic(); timer = every(automatic, DAILY); timer?.unref?.(); },
    stop() { if (timer !== null) cancel(timer); timer = null; },
  };
}
