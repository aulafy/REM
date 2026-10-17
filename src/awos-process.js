import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {createAwosClient} from './awos-client.js';
export async function startAwos(config,local){
 const token=randomBytes(32).toString('hex');
 const env={PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,HOME:process.env.HOME,PYME1_AWOS_DIR:config.runtimeDir,PYME1_AWOS_TOKEN:token,PYME1_AWOS_PLANNER:config.planner,
  ...(local?{LLAMA_BASE_URL:local.url,LLAMA_MODEL:local.model}:{} )};
 const child=fork(join(config.repo,'pymes/tests/fixtures/pyme1-harness.ts'),[],{cwd:config.repo,env,execPath:process.execPath,execArgv:['--disable-warning=ExperimentalWarning','--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
 let alive=true;child.on('exit',()=>{alive=false;});child.stderr.on('data',()=>{}); // No provider text or secrets in product logs.
 const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('AWOS_START_TIMEOUT'));},20_000);
  child.once('error',()=>{clearTimeout(timer);reject(Error('AWOS_START_FAILED'));});child.once('exit',()=>{clearTimeout(timer);reject(Error('AWOS_START_FAILED'));});
  child.once('message',m=>{clearTimeout(timer);if(m?.type==='ready'&&Number.isInteger(m.port))resolve(m);else{child.kill('SIGTERM');reject(Error('AWOS_START_FAILED'));}});
 });
 const client=createAwosClient({port:ready.port,token});
 return {client,child,port:ready.port,ready:()=>alive,close:async()=>{if(!alive)return;await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}};
}
