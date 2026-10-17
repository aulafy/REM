#!/usr/bin/env node
// Explicit developer entry point. Never reads installed app settings or starts production data.
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
import {experimentalConfig} from '../src/awos-guard.js';
import {acquireAwosLocks} from '../src/awos-locks.js';import {openDb} from '../src/db.js';
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
if(!args.includes('--awos'))throw Error('Usage: node scripts/qa-awos.js --awos /path/to/agent-world-os [--model local-model | --synthetic] [--reuse /tmp/previous-root] [--port 4390]');
const planner=args.includes('--synthetic')?'synthetic':'local';
if(planner==='local'&&!args.includes('--model'))throw Error('Choose the installed local model explicitly with --model; no model is downloaded.');
const root=args.includes('--reuse')?realpathSync(arg('--reuse')):mkdtempSync(join(tmpdir(),'pyme1-awos-qa-'));
const data=join(root,'data'),runtime=join(root,'runtime');mkdirSync(data,{recursive:true,mode:0o700});mkdirSync(runtime,{recursive:true,mode:0o700});
const env={...process.env,PYME1_AWOS_EXPERIMENTAL:'1',PYME1_DATA_DIR:data,PYME1_AWOS_DIR:runtime,PYME1_SECRETS:'memory',PYME1_PORT:args.includes('--port')?arg('--port'):'4390',PYME1_AWOS_REPO:arg('--awos'),PYME1_AWOS_PLANNER:planner};
const config=experimentalConfig(env),release=acquireAwosLocks(config);
try{
if(planner==='local'){const db=openDb(join(data,'pyme1.db'));db.setSetting('local',{enabled:true,url:'http://127.0.0.1:11434',model:arg('--model')});db.close();}
writeFileSync(join(root,'qa-config.json'),JSON.stringify({root,data,runtime,planner,port:Number(env.PYME1_PORT)},null,2),{mode:0o600});
}finally{release();}
console.log('QA synthetic root:',root);
const cwd=dirname(dirname(fileURLToPath(import.meta.url)));
const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','src/server.js'],{cwd,env,stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>child.kill(sig));
