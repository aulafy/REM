#!/usr/bin/env node
import {createRemModules} from './rem-modules.js';
// Arranque: abre la base de datos, levanta el servidor en 127.0.0.1 y abre el navegador.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import {experimentalConfig} from './awos-guard.js';
import {acquireAwosLocks} from './awos-locks.js';
import {createAwosMaintenance} from './awos-maintenance.js';
import {createAwosCopyService} from './awos-copy-service.js';
import {chooseAwosCopyDirectory} from './awos-copy-picker.js';
import {restoredAppReceipt,writePrivateJson} from './awos-restored-app.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startAwos} from './awos-process.js';
import {createAwosFlow} from '../modules/proposals/index.js';
import {createAwosBusiness} from '../modules/closure/index.js';
import {createAwosIntakes} from '../modules/requests/index.js';
import {createAwosFollowups,createFollowupScheduler} from '../modules/followups/index.js';
import {draftAwos,suggestProposalText} from './awos-drafter.js';
import {assertLocalModel} from './local-only.js';
import {loadSettings} from './settings.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`REM necesita Node.js 22.13 o superior. Tienes ${process.versions.node}. Descárgalo en https://nodejs.org`);
  process.exit(1);
}

const { openDb } = await import('./db.js');
const { makeSecrets } = await import('./secrets.js');
const { createApp } = await import('./api.js');
const { createBackups } = await import('./backups.js');

// Validate before opening any database or backup path.
const experimental=experimentalConfig();
if(process.env.PYME1_RESTORED_LAUNCH_ID&&!experimental)throw Error('AWOS_RESTORED_LAUNCH_INVALID');
const maintenance=experimental?createAwosMaintenance():undefined;
const releaseAwosLocks=experimental?acquireAwosLocks(experimental):()=>{};
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.PYME1_DATA_DIR
  || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Pyme1') : join(homedir(), '.local', 'share', 'pyme1'));
const db = openDb(join(dataDir, 'pyme1.db'));
const secrets = makeSecrets({ dir: dataDir, mode: process.env.PYME1_SECRETS || undefined });
const token = randomBytes(24).toString('hex');
const backups = createBackups({ db, dataDir });
let awos,copies,followupScheduler;
let closing = false;
if(experimental){
 const local=experimental.planner==='local'?await assertLocalModel(loadSettings(db).local):undefined;
 const host=await startAwos(experimental,local);
 let followups;const flow=createAwosFlow(db,host.client,{onSupersede:(op,version)=>followups?.supersede(op,version)});followups=createAwosFollowups(db,flow);
 awos={host,flow,followups,modules:createRemModules(host.client),business:createAwosBusiness(db,flow,host.client,followups),intakes:createAwosIntakes(db,host.client),draft:draftAwos,suggest:suggestProposalText,planner:experimental.planner};followupScheduler=createFollowupScheduler(followups);followupScheduler.start();
}
async function restartAwos(){
 if(!experimental||closing)throw Error('AWOS_COPY_CLOSING');
 const local=experimental.planner==='local'?await assertLocalModel(loadSettings(db).local):undefined;
 const host=await startAwos(experimental,local);followupScheduler?.stop();let followups;const flow=createAwosFlow(db,host.client,{onSupersede:(op,version)=>followups?.supersede(op,version)});followups=createAwosFollowups(db,flow);awos.host=host;awos.modules=createRemModules(host.client);awos.flow=flow;awos.followups=followups;awos.business=createAwosBusiness(db,flow,host.client,followups);awos.intakes=createAwosIntakes(db,host.client);followupScheduler=createFollowupScheduler(followups);followupScheduler.start();
}
if(experimental&&dirname(experimental.dataDir)===dirname(experimental.runtimeDir)){
 const pause=fn=>maintenance.run(async()=>{backups.stop();await awos.host.close();try{return await fn();}finally{if(!closing){try{await restartAwos();}finally{backups.start();}}}});
 copies=createAwosCopyService({config:experimental,chooseDirectory:chooseAwosCopyDirectory,withPaused:pause,runtimeReady:()=>awos.host.ready(),resumeRuntime:()=>maintenance.run(async()=>{if(!awos.host.ready())await restartAwos();}),reveal:path=>promisify(execFile)('/usr/bin/open',['-R',path])});
}
let port = Number(process.env.PYME1_PORT || 4317);

const instanceId = createHash('sha256').update(realpathSync(dataDir)).digest('hex');
function shutdown() {
  if (closing) return;
  closing = true;
  maintenance?.close();
  followupScheduler?.stop();
  backups.stop();
  server.close(async () => { await copies?.close();await awos?.host.close(); db.close(); releaseAwosLocks(); process.exit(0); });
  server.closeIdleConnections();
  // Un proveedor bloqueado no puede impedir el cierre indefinidamente.
  setTimeout(() => process.exit(0), 5000).unref();
}
const handler = createApp({ db, secrets, token, onShutdown: shutdown, instanceId, backups, awos, copies, maintenance, staticDir: join(here, '..', 'public'), getPort: () => port });
const server = createServer(handler);
server.requestTimeout = 300_000;

function listen(attempt = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && !experimental && attempt < 10) { port += 1; listen(attempt + 1); }
    else { console.error('No se pudo arrancar el servidor:', e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    port=server.address().port;
    backups.start();
    if(process.env.PYME1_RESTORED_LAUNCH_ID)writePrivateJson(join(dirname(experimental.dataDir),'restored-app.json'),restoredAppReceipt({...experimental,port},process.env.PYME1_RESTORED_LAUNCH_ID));
    process.send?.({type:'pyme1-ready',port,instanceId});
    const url = `http://127.0.0.1:${port}/`;
    console.log(`\nREM está funcionando en ${url}`);
    console.log(`Datos: ${dataDir}`);
    console.log(`Claves de API: ${secrets.where}`);
    console.log('Para cerrar: Ajustes → Cerrar REM, menú de la app o Ctrl+C.\n');
    if (process.argv.includes('--open')) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    }
  });
}
listen();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
