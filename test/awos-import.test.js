import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';import {join} from 'node:path';import {readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {managedFixture} from './helpers/awos-managed-fixture.js';
import {importAwosCopy,inspectAwosCopy} from '../src/awos-archive.js';
import {chooseAwosCopyDirectory} from '../src/awos-copy-picker.js';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function source(t){const f=await managedFixture(t);await f.flow().prepare({opId:randomUUID(),commandId:randomUUID(),expectedVersion:0,contactId:'qa-elena',request:'Agradece la documentación.',subject:'Gracias',body:'Gracias.'});const id=randomUUID();await f.service.request('create',{requestId:id});await f.service.settled();return {f,path:join(f.root,'copias-conjuntas','pyme1-awos-copy-'+id)};}

test('import copies verified bytes into its catalog, preserves source/current journal and restores independently',async t=>{
 const src=await source(t),before=inspectAwosCopy(src.path,{withFingerprint:true});let picks=0;const f=await managedFixture(t,{chooseDirectory:async()=>{picks++;return src.path;}}),id=randomUUID();
 const currentBefore=await f.flow().list();await f.service.request('import',{requestId:id});await f.service.settled();let s=await f.service.status(),c=s.copies[0];assert.equal(s.jobs[0].state,'completed',JSON.stringify(s.jobs));assert.equal(c.copyId,id);assert.equal(c.sourceManifestHash,before.manifestHash);assert.equal(c.summary.reviews,1);assert.equal(c.summary.fakeCalls,0);assert.equal(f.starts,0);assert.deepEqual(await f.flow().list(),currentBefore);assert.deepEqual(inspectAwosCopy(src.path,{withFingerprint:true}),before);
 await f.reopen();assert.equal((await f.service.request('import',{requestId:id})).job.state,'completed');assert.equal(picks,1);assert.equal((await f.service.status()).copies.length,1);
 const rid=randomUUID();await f.service.request('restore',{requestId:rid,copyId:id,manifestHash:c.manifestHash,confirmation:'RESTAURAR'});await f.service.settled();const r=(await f.service.status()).jobs.find(j=>j.id===rid);assert.equal(r.state,'completed');assert.equal(r.result.summary.reviews,1);t.after(()=>rmSync(r.result.root,{recursive:true,force:true}));
 rmSync(src.path,{recursive:true});assert.equal((await f.service.status()).copies[0].copyId,id);assert.equal((await f.service.request('import',{requestId:id})).job.state,'completed');
});
test('native selection is the only input: HTTP-style paths/flags rejected; cancel changes no business data',async t=>{
 let picks=0;const f=await managedFixture(t,{chooseDirectory:async()=>{picks++;return null;}}),before=await f.flow().list();
 for(const extra of [{path:'/private/elsewhere'},{execute:true},{manifestHash:'a'.repeat(64)}])await assert.rejects(f.service.request('import',{requestId:randomUUID(),...extra}),/INPUT_INVALID/);
 assert.equal(picks,0);const id=randomUUID();await f.service.request('import',{requestId:id});await f.service.settled();const s=await f.service.status();assert.equal(s.jobs[0].state,'failed');assert.equal(s.jobs[0].error,'AWOS_COPY_SELECTION_CANCELLED');assert.equal(s.copies.length,0);assert.deepEqual(await f.flow().list(),before);assert.ok(f.host.ready());
});
test('retry binds to durable selected hash; changed source fails instead of reselecting or importing new content',async t=>{
 const src=await source(t);let picks=0,fail=true;const f=await managedFixture(t,{chooseDirectory:async()=>{picks++;return src.path;},hooks:{afterPersist:p=>{if(p==='selected'&&fail)throw Error('STOP_AFTER_SELECTION');}}}),id=randomUUID();await f.service.request('import',{requestId:id});await f.service.settled();fail=false;
 const file=join(src.path,'manifest.json');writeFileSync(file,readFileSync(file,'utf8')+' ');await f.reopen();await f.service.retry(id);await f.service.settled();const s=await f.service.status();assert.equal(picks,1);assert.equal(s.copies.length,0);assert.equal(s.jobs[0].state,'failed');assert.equal(s.jobs[0].error,'AWOS_COPY_CHANGED');
});
test('replay failure never publishes an import even with internally matching hashes',async t=>{
 const src=await source(t),file=join(src.path,'data/pyme1.db');const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(file);db.exec('DELETE FROM awos_ops');db.close();const mf=join(src.path,'manifest.json'),m=JSON.parse(readFileSync(mf));m.files[0].sha256=sha(file);m.files[0].bytes=readFileSync(file).length;writeFileSync(mf,JSON.stringify(m));const f=await managedFixture(t,{chooseDirectory:async()=>src.path});await f.service.request('import',{requestId:randomUUID()});await f.service.settled();const s=await f.service.status();assert.equal(s.copies.length,0);assert.equal(s.jobs[0].error,'AWOS_COPY_REPLAY_OR_PAIR_INVALID');assert.deepEqual(readdirSync(join(f.root,'copias-conjuntas')),[]);
});
test('direct import rejects changed files and cleans stage after failure; prior copies remain intact',async t=>{
 const src=await source(t),f=await managedFixture(t),checked=inspectAwosCopy(src.path,{withFingerprint:true}),id='copy-'+randomUUID();
 await assert.rejects(importAwosCopy({path:src.path,repo:f.repo,output:f.output,copyId:id,expectedManifestHash:'a'.repeat(64)}),/CHANGED/);
 await assert.rejects(importAwosCopy({path:src.path,repo:f.repo,output:f.output,copyId:id,expectedManifestHash:checked.manifestHash,hooks:{afterFile:()=>{throw Error('DISK_FAILURE');}}}),/DISK_FAILURE/);assert.deepEqual(readdirSync(f.output),[]);assert.equal(inspectAwosCopy(src.path,{withFingerprint:true}).manifestHash,checked.manifestHash);
});
test('folder picker uses fixed argv without shell, preserves spaces and sanitizes errors',async()=>{
 let calls=0;const selected='/tmp/copia propia/';assert.equal(await chooseAwosCopyDirectory({platform:'darwin',runner:async(cmd,args,opts)=>{calls++;assert.equal(cmd,'/usr/bin/osascript');assert.equal(args.length,2);assert.equal(args[0],'-e');assert.equal(opts.shell,undefined);assert.equal(opts.timeout,120000);return {stdout:selected+'\n'};}}),selected);assert.equal(calls,1);
 await assert.rejects(chooseAwosCopyDirectory({platform:'linux',runner:()=>{throw Error('MUST_NOT_RUN');}}),/PICKER_UNAVAILABLE/);
 await assert.rejects(chooseAwosCopyDirectory({platform:'darwin',runner:()=>{throw Object.assign(Error('private path'),{stderr:'User canceled. (-128)'});}}),/SELECTION_CANCELLED/);
 await assert.rejects(chooseAwosCopyDirectory({platform:'darwin',runner:()=>{throw Error('/private/secret');}}),e=>e.message==='AWOS_COPY_PICKER_UNAVAILABLE');
});

test('one pending native dialog per controller; repeated request reuses the job and cancellation can be explicitly retried',async t=>{
 const src=await source(t);let finish,picks=0;const held=new Promise(ok=>finish=ok);const f=await managedFixture(t,{chooseDirectory:async()=>{picks++;return picks===1?held:src.path;}}),id=randomUUID();
 await f.service.request('import',{requestId:id});assert.equal(picks,1);assert.equal((await f.service.request('import',{requestId:id})).job.state,'running');await assert.rejects(f.service.request('import',{requestId:randomUUID()}),/BUSY/);assert.equal(picks,1);assert.ok(f.host.ready());assert.equal(f.gate.busy(),false);assert.equal((await f.service.status()).busy,true);
 finish(null);await f.service.settled();assert.equal((await f.service.status()).jobs[0].error,'AWOS_COPY_SELECTION_CANCELLED');await f.reopen();await f.service.retry(id);await f.service.settled();const s=await f.service.status();assert.equal(s.jobs.length,1);assert.equal(s.jobs[0].state,'completed');assert.equal(s.copies.length,1);assert.equal(picks,2);
});

test('SIGKILL of dialog owner cancels IPC worker and its owned synthetic dialog process',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),{setTimeout:delay}=await import('node:timers/promises');
 const child=spawn(process.execPath,['test/helpers/awos-picker-crash.mjs'],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const [code,signal]=await once(child,'exit');assert.equal(code,null,stderr);assert.equal(signal,'SIGKILL',stderr);const pids=JSON.parse(stdout);
 for(const pid of Object.values(pids)){let gone=false;for(let n=0;n<100;n++){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){gone=true;break;}throw e;}await delay(25);}assert.equal(gone,true,'Owned synthetic dialog/worker must exit');}
});
