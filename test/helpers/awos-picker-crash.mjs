import {fork,spawn} from 'node:child_process';import {once} from 'node:events';import {writeSync} from 'node:fs';
import {serveCopyPicker} from '../../src/awos-copy-picker-worker.js';
if(process.argv[2]==='worker'){
 await serveCopyPicker({dialog:async({signal})=>{
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}),gone=once(child,'exit');
  process.send({pid:child.pid});await new Promise(ok=>signal.addEventListener('abort',ok,{once:true}));child.kill('SIGTERM');await gone;throw Error('ABORTED');
 }});
}else{
 const worker=fork(process.argv[1],['worker'],{stdio:['ignore','ignore','ignore','ipc']});worker.once('message',m=>{writeSync(1,JSON.stringify({worker:worker.pid,dialog:m.pid})+'\n');process.kill(process.pid,'SIGKILL');});
}
