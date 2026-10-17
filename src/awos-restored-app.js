// Starts only a verified temporary clone after an explicit user action.
import {fork} from 'node:child_process';import {createServer} from 'node:net';
import {readFileSync,writeFileSync,lstatSync,realpathSync,renameSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {loadCopySource} from './awos-archive.js';import {acquireAwosLocks} from './awos-locks.js';
const here=dirname(fileURLToPath(import.meta.url));
export function writePrivateJson(path,value){const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);const dir=openSync(dirname(path),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
export function restoredAppReceipt(config,nonce){
 if(!config||typeof nonce!=='string'||!/^[a-f0-9-]{36}$/.test(nonce)||dirname(config.dataDir)!==dirname(config.runtimeDir))throw Error('AWOS_RESTORED_LAUNCH_INVALID');
 return {format:'pyme1-restored-app-v1',nonce,pid:process.pid,port:config.port,instanceId:createHash('sha256').update(realpathSync(config.dataDir)).digest('hex'),at:Date.now()};
}
export async function probeRestoredApp(root,repo,allowedNonces){
 try{
  const c=loadCopySource(root,repo),path=join(root,'restored-app.json'),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)return null;
  const r=JSON.parse(readFileSync(path,'utf8'));if(r.format!=='pyme1-restored-app-v1'||!allowedNonces.includes(r.nonce)||!Number.isSafeInteger(r.pid)||r.pid<1||r.port!==c.port||r.port===4317||r.instanceId!==createHash('sha256').update(realpathSync(c.dataDir)).digest('hex'))return null;
  const response=await fetch(`http://127.0.0.1:${r.port}/`,{redirect:'error',signal:AbortSignal.timeout(1000)});const valid=response.ok&&response.headers.get('x-pyme1-instance')===r.instanceId;await response.body?.cancel();return valid?{url:`http://127.0.0.1:${r.port}/#awos`,port:r.port,instanceId:r.instanceId,pid:r.pid}:null;
 }catch{return null;}
}
export async function startRestoredApp(root,repo,nonce){
 const c=loadCopySource(root,repo),release=acquireAwosLocks(c);let port;
 try{const socket=createServer();await new Promise((ok,bad)=>{socket.once('error',bad);socket.listen(0,'127.0.0.1',ok);});port=socket.address().port;await new Promise(ok=>socket.close(ok));if(port===4317||port<1024)throw Error('AWOS_RESTORED_PORT_INVALID');writePrivateJson(join(root,'qa-config.json'),{root:realpathSync(root),data:c.dataDir,runtime:c.runtimeDir,planner:'synthetic',port});}finally{release();}
 const child=fork(join(here,'server.js'),[],{cwd:join(here,'..'),execPath:process.execPath,execArgv:['--disable-warning=ExperimentalWarning'],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,PYME1_AWOS_EXPERIMENTAL:'1',PYME1_DATA_DIR:c.dataDir,PYME1_AWOS_DIR:c.runtimeDir,PYME1_AWOS_REPO:c.repo,PYME1_PORT:String(port),PYME1_SECRETS:'memory',PYME1_AWOS_PLANNER:'synthetic',PYME1_RESTORED_LAUNCH_ID:nonce},stdio:['ignore','ignore','ignore','ipc'],detached:true});
 try{
  await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('AWOS_RESTORED_START_TIMEOUT')),20_000);const fail=()=>{clearTimeout(timer);bad(Error('AWOS_RESTORED_START_FAILED'));};child.once('error',fail);child.once('exit',fail);child.once('message',m=>{clearTimeout(timer);m?.type==='pyme1-ready'&&m.port===port?ok():bad(Error('AWOS_RESTORED_START_FAILED'));});});
  const result=await probeRestoredApp(root,repo,[nonce]);if(!result)throw Error('AWOS_RESTORED_UNCONFIRMED');if(child.connected)child.disconnect();child.unref();return result;
 }catch(e){if(child.exitCode===null&&child.signalCode===null){await new Promise(ok=>{const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('exit',()=>{clearTimeout(timer);ok();});child.kill('SIGTERM');});}throw e;}
}
