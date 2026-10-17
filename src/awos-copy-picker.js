import {execFile,fork} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile);
// Fixed script, no shell and no path supplied by HTTP. Test runners never open
// real dialogs. Production runs in an IPC worker that cancels on owner loss.
export async function runAwosFolderDialog({runner=run,signal}={}){
 try{
  const result=await runner('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "Selecciona una copia conjunta de REM creada por ti (carpeta con manifest.json)")'],{timeout:120_000,maxBuffer:8192,...(signal?{signal}:{})});
  const selected=result.stdout.replace(/\r?\n$/,'');if(!selected.startsWith('/')||selected.includes('\0'))throw Error();return selected;
 }catch(e){if(typeof e.stderr==='string'&&/\(-128\)/.test(e.stderr))throw Error('AWOS_COPY_SELECTION_CANCELLED');throw Error('AWOS_COPY_PICKER_UNAVAILABLE');}
}
export async function chooseAwosCopyDirectory({runner,platform=process.platform}={}){
 if(platform!=='darwin')throw Error('AWOS_COPY_PICKER_UNAVAILABLE');
 if(runner)return runAwosFolderDialog({runner});
 const child=fork(fileURLToPath(new URL('./awos-copy-picker-worker.js',import.meta.url)),[],{execPath:process.execPath,execArgv:[],env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['ignore','ignore','ignore','ipc']});
 let reply;
 return new Promise((ok,bad)=>{
  const timer=setTimeout(()=>{if(child.connected)child.disconnect();},123_000);timer.unref();
  child.once('message',value=>{reply=value;});
  const fail=()=>{clearTimeout(timer);bad(Error('AWOS_COPY_PICKER_UNAVAILABLE'));};child.once('error',fail);
  // Wait for worker exit, so a canceled dialog has been cleaned before retry.
  child.once('exit',code=>{clearTimeout(timer);if(code===0&&typeof reply?.path==='string')ok(reply.path);else bad(Error(reply?.error==='AWOS_COPY_SELECTION_CANCELLED'?'AWOS_COPY_SELECTION_CANCELLED':'AWOS_COPY_PICKER_UNAVAILABLE'));});
 });
}
