// Rellena REM con datos ficticios desde la terminal.
// Uso: node scripts/demo.js [carpeta-de-datos] [--forzar]
// Por defecto usa PYME1_DATA_DIR o ~/Library/Application Support/Pyme1. También se puede hacer desde Ajustes.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { openDb } from '../src/db.js';
import { seedDemo, hasData } from '../src/demo.js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || process.env.PYME1_DATA_DIR || join(homedir(), 'Library', 'Application Support', 'Pyme1');
const file = join(dir, 'pyme1.db');
const existed = existsSync(file);
const db = openDb(file);
if (hasData(db) && !args.includes('--forzar')) {
  console.error('Ya hay datos en esta carpeta. Vuelve a ejecutarlo con --forzar para añadir la demo igualmente.');
  db.close(); process.exit(1);
}
// Copia de lo que hubiera antes (ajustes incluidos), por si quieres volver atrás.
if (existed) db.backupTo(join(dir, `pyme1-antes-de-demo-${new Date().toISOString().replace(/[:.]/g, '-')}.db`));
seedDemo(db);
db.close();
console.log(`Datos de ejemplo cargados en ${file}`);
