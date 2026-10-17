import test from 'node:test';import assert from 'node:assert/strict';import {once} from 'node:events';import {fork} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {fixture,awosRepo} from './helpers/awos-harness.js';import {startAwos} from '../src/awos-process.js';import {createAwosFlow} from '../src/awos-flow.js';import {openDb} from '../src/db.js';
const input=()=>({opId:randomUUID(),commandId:randomUUID(),expectedVersion:0,contactId:'qa-luis',request:'Agradecer',subject:'Gracias',body:'Gracias por la ayuda.'});
for(const phase of ['created','planned','draft','reviewed'])test('SIGKILL real AWOS tras '+phase+': recuperación sin tareas ni revisiones duplicadas',async()=>{
 const f=await fixture();try{const i=input();let hit=false;const flow=createAwosFlow(f.db,f.host.client,{hook:stage=>{if(stage===phase&&!hit){hit=true;f.host.child.kill('SIGKILL');throw Error('CRASH_INJECTED');}}});
  await assert.rejects(flow.prepare(i),/CRASH_INJECTED/);const [,signal]=await once(f.host.child,'exit');assert.equal(signal,'SIGKILL');assert.equal(hit,true);
  await f.restart();const v=await f.flow().resume(i.opId,1);assert.equal(v.state,'approval');assert.equal(v.remote.review.payload.body,i.body);assert.deepEqual(v.remote.effects,[]);
  const again=await f.flow().prepare(i);assert.equal(again.remote.review.id,v.remote.review.id);assert.equal((await f.flow().list()).length,1);
 }finally{await f.close();}
});
test('SIGKILL AWOS después de decisión conserva aprobación y auditoría única',async()=>{
 const f=await fixture();try{const i=input(),v=await f.flow().prepare(i),a={commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'approved'};await f.flow().decide(i.opId,1,a);
  const exit=once(f.host.child,'exit');f.host.child.kill('SIGKILL');assert.equal((await exit)[1],'SIGKILL');await f.restart();const back=await f.flow().get(i.opId,1);assert.equal(back.remote.decision.decision,'approved');assert.equal(back.remote.audit.filter(x=>x.type==='approval.approved').length,1);assert.deepEqual(back.remote.effects,[]);
 }finally{await f.close();}
});
for(const phase of ['recorded','draft'])test('SIGKILL real REM tras '+phase+': restaura contenido y cierra su hijo por IPC',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pyme1-parent-crash-')),runtimeDir=join(root,'runtime'),file=join(root,'pyme1.db');mkdirSync(runtimeDir);const config={runtimeDir,repo:awosRepo,planner:'synthetic'},i=input();let host,db;
 try{const worker=fork(new URL('./helpers/awos-crash-worker.js',import.meta.url),[JSON.stringify(config),file,JSON.stringify(i),phase],{execArgv:['--disable-warning=ExperimentalWarning'],stdio:['ignore','ignore','pipe','ipc']});
  let stderr='';worker.stderr.on('data',x=>stderr+=x);const exit=once(worker,'exit');const [code,signal]=await exit;assert.equal(code,null,stderr);assert.equal(signal,'SIGKILL');
  for(let k=0;k<100&&existsSync(join(runtimeDir,'runtime.lock'));k++)await new Promise(r=>setTimeout(r,20));
  assert.equal(existsSync(join(runtimeDir,'runtime.lock')),false,'orphan runtime must close on IPC disconnect');
  host=await startAwos(config);db=openDb(file);const flow=createAwosFlow(db,host.client);const v=await flow.resume(i.opId,1);assert.equal(v.remote.review.payload.body,i.body);assert.equal(v.state,'approval');assert.equal((await flow.list()).length,1);
 }finally{await host?.close();db?.close();rmSync(root,{recursive:true,force:true});}
});
