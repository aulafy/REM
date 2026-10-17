import {freePort} from './helpers/free-port.js';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,rmSync,symlinkSync,lstatSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {DatabaseSync} from 'node:sqlite';import {createServer} from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {createAwosCopy,restoreAwosCopy,inspectAwosCopy,loadCopySource} from '../src/awos-archive.js';import {acquireAwosLocks} from '../src/awos-locks.js';import {copyFixture} from './helpers/awos-copy-fixture.js';import {startAwos} from '../src/awos-process.js';import {createAwosFlow} from '../src/awos-flow.js';import {openDb} from '../src/db.js';
const initial=()=>({opId:randomUUID(),commandId:randomUUID(),expectedVersion:0,contactId:'qa-elena',request:'Agradece la documentación.',subject:'Gracias',body:'Gracias por la documentación.'});
const create=f=>createAwosCopy({config:f.config,repo:f.repo,output:f.output});
function rewriteManifest(root,fn){const file=join(root,'manifest.json'),m=JSON.parse(readFileSync(file));fn(m);writeFileSync(file,JSON.stringify(m));}
function rehash(root,name){rewriteManifest(root,m=>{const bytes=readFileSync(join(root,name)),f=m.files.find(f=>f.path===name);f.bytes=bytes.length;f.sha256=createHash('sha256').update(bytes).digest('hex');});}

test('offline pair copy restores exact decisions, supersession, one CRM lead and pending successor',async t=>{
 const f=await copyFixture(t),i=initial();let v=await f.flow.prepare(i);await f.flow.decide(i.opId,1,{commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'approved'});v=await f.flow.prepare({...i,commandId:randomUUID(),expectedVersion:1,body:'Segunda versión exacta.'});const binding=v.remote.review.bindingHash;
 await assert.rejects(create(f),/RUNNING/);await f.stop();const copy=await create(f);assert.equal(copy.verified.cancelled,1);assert.equal(copy.verified.crmLeads,1);assert.equal(copy.verified.fakeCalls,0);assert.equal(copy.verified.fakeReceipts,0);assert.equal(copy.verified.decisions,1);
 assert.deepEqual(readdirSync(copy.path).sort(),['data','manifest.json','runtime']);assert.equal(inspectAwosCopy(copy.path).files.length,4);for(const file of copy.manifest.files)assert.equal(lstatSync(join(copy.path,file.path)).mode&0o777,0o600);
 const restored=await restoreAwosCopy({path:copy.path,repo:f.repo,port:await freePort()});t.after(()=>rmSync(restored.root,{recursive:true,force:true}));
 assert.notEqual(restored.root,f.root);assert.equal(restored.verified.journalRevision,copy.verified.journalRevision);
 const config=loadCopySource(restored.root,f.repo),host=await startAwos(config),db=openDb(join(config.dataDir,'pyme1.db'));try{const flow=createAwosFlow(db,host.client),rows=await flow.list();assert.deepEqual(rows.map(r=>r.state),['approval','cancelled']);assert.equal(rows[0].remote.review.bindingHash,binding);assert.equal(rows[1].remote.decision.decision,'approved');assert.equal((await host.client.call('crm','qa-elena')).leads.length,1);assert.equal((await flow.resume(i.opId,2)).remote.review.bindingHash,binding);}finally{await host.close();db.close();}
});
test('read-only VACUUM captures committed WAL and excludes secrets, logs, backups, locks and extra files',async t=>{
 const f=await copyFixture(t);await f.flow.prepare(initial());await f.stop();
 const db=new DatabaseSync(join(f.config.dataDir,'pyme1.db'));db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO clients(name,created_at,updated_at) VALUES('Solo WAL','now','now')");
 writeFileSync(join(f.config.dataDir,'secrets.json'),'never export synthetic secret');writeFileSync(join(f.config.runtimeDir,'token.log'),'never export synthetic token');
 const copy=await create(f);db.close();const read=new DatabaseSync(join(copy.path,'data/pyme1.db'),{readOnly:true});assert.equal(read.prepare("SELECT count(*) n FROM clients WHERE name='Solo WAL'").get().n,1);read.close();assert.ok(!JSON.stringify(copy.manifest).includes('secrets'));assert.deepEqual(readdirSync(join(copy.path,'runtime')).sort(),['runtime.db','runtime.db.capsules.db','runtime.db.fake-email.db']);
});
test('refuses active pair locks; SIGKILL releases them without removing PID files or starting a runtime',async t=>{
 const f=await copyFixture(t);await f.stop();const release=acquireAwosLocks(f.config);await assert.rejects(create(f),/PAIR_IN_USE/);assert.throws(()=>acquireAwosLocks(f.config),/PAIR_IN_USE/);release();release();
 const child=spawn(process.execPath,['--input-type=module','-e',`import {acquireAwosLocks} from './src/awos-locks.js';acquireAwosLocks(JSON.parse(process.argv[1]));process.stdout.write('locked\\n');setInterval(()=>{},1000);`,JSON.stringify(f.config)],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});await once(child.stdout,'data');child.kill('SIGKILL');assert.equal((await once(child,'exit'))[1],'SIGKILL');assert.ok((await create(f)).path);
});
test('integrity hashes, exact layout, schema and symlinks are checked before publishing a restore',async t=>{
 const f=await copyFixture(t);await f.flow.prepare(initial());await f.stop();const copy=await create(f),file=join(copy.path,'data/pyme1.db'),original=readFileSync(file);
 writeFileSync(file,Buffer.from('corrupt'));assert.throws(()=>inspectAwosCopy(copy.path),/HASH_MISMATCH/);writeFileSync(file,original);
 writeFileSync(join(copy.path,'extra.txt'),'not a bundle member');assert.throws(()=>inspectAwosCopy(copy.path),/LAYOUT/);rmSync(join(copy.path,'extra.txt'));
 const m=JSON.parse(readFileSync(join(copy.path,'manifest.json')));rewriteManifest(copy.path,m=>m.files[0].path='../../elsewhere');assert.throws(()=>inspectAwosCopy(copy.path),/MANIFEST/);writeFileSync(join(copy.path,'manifest.json'),JSON.stringify(m));
 const alias=join(f.root,'bundle-alias');symlinkSync(copy.path,alias);assert.throws(()=>inspectAwosCopy(alias),/DIRECTORY/);rmSync(alias);
 rmSync(file);symlinkSync(join(f.config.dataDir,'pyme1.db'),file);assert.throws(()=>inspectAwosCopy(copy.path),/FILE_INVALID/);rmSync(file);writeFileSync(file,original,{mode:0o600});
 const db=new DatabaseSync(file);db.exec("UPDATE awos_ops SET payload=json_set(payload,'$.body','Mixed backup')");db.close();rehash(copy.path,'data/pyme1.db');assert.ok(inspectAwosCopy(copy.path));await assert.rejects(restoreAwosCopy({path:copy.path,repo:f.repo,port:await freePort()}),/REPLAY_OR_PAIR_INVALID/);
});
test('missing local intent or runtime task is rejected even when all declared hashes match',async t=>{
 const f=await copyFixture(t);await f.flow.prepare(initial());await f.stop();const copy=await create(f),file=join(copy.path,'data/pyme1.db');
 const db=new DatabaseSync(file);db.exec('DELETE FROM awos_ops');db.close();rehash(copy.path,'data/pyme1.db');await assert.rejects(restoreAwosCopy({path:copy.path,repo:f.repo,port:await freePort()}),/REPLAY_OR_PAIR_INVALID/);
});
test('source and output guards reject real-style directories, nested output and production port',async t=>{
 const f=await copyFixture(t);await f.stop();await assert.rejects(createAwosCopy({config:{...f.config,port:4317},repo:f.repo,output:f.output}),/QA_PORT/);await assert.rejects(createAwosCopy({config:f.config,repo:f.repo,output:f.config.dataDir}),/OVERLAP/);
 const file=join(f.root,'qa-config.json'),original=readFileSync(file);writeFileSync(file,JSON.stringify({root:f.root,data:f.config.dataDir,runtime:f.config.runtimeDir,port:4317,planner:'synthetic'}));assert.throws(()=>loadCopySource(f.root,f.repo),/QA_PORT/);writeFileSync(file,original);
 const copy=await create(f);await assert.rejects(restoreAwosCopy({path:copy.path,repo:f.repo,port:4317}),/QA_PORT/);assert.ok(inspectAwosCopy(copy.path));
});
test('failure during snapshot never publishes partial data or deletes a prior valid copy',async t=>{
 const f=await copyFixture(t);await f.flow.prepare(initial());await f.stop();const first=await create(f);const before=JSON.stringify(inspectAwosCopy(first.path));
 await assert.rejects(createAwosCopy({config:f.config,repo:f.repo,output:f.output,hooks:{afterFile:()=>{throw Error('DISK_FAILURE');}}}),/DISK_FAILURE/);assert.equal(JSON.stringify(inspectAwosCopy(first.path)),before);assert.equal(readdirSync(f.output).length,1);
 await assert.rejects(restoreAwosCopy({path:first.path,repo:f.repo,port:await freePort(),hooks:{beforePublish:()=>{throw Error('RESTORE_FAILURE');}}}),/RESTORE_FAILURE/);assert.equal(JSON.stringify(inspectAwosCopy(first.path)),before);
});
for(const action of ['create','restore'])for(const phase of ['before','after'])test(`SIGKILL ${phase} ${action} publication leaves no advertised partial pair`,{timeout:15_000},async t=>{
 const f=await copyFixture(t);await f.flow.prepare(initial());await f.stop();const source=await create(f);
 const args=action==='create'?{config:f.config,repo:f.repo,output:f.output}:{path:source.path,repo:f.repo,port:await freePort()};
 const child=spawn(process.execPath,['test/helpers/awos-copy-crash.js',action,phase,JSON.stringify(args)],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const [code,signal]=await once(child,'exit');assert.equal(code,null,stderr);assert.equal(signal,'SIGKILL',stderr);const seen=JSON.parse(stdout.trim());
 if(seen.stage)t.after(()=>rmSync(seen.stage,{recursive:true,force:true}));if(action==='restore'&&phase==='after')t.after(()=>rmSync(seen.target,{recursive:true,force:true}));
 if(phase==='before'){assert.throws(()=>lstatSync(seen.target),{code:'ENOENT'});assert.ok(inspectAwosCopy(source.path));}
 else if(action==='create'){assert.ok(inspectAwosCopy(seen.target));assert.equal(inspectAwosCopy(seen.target).files.length,4);}
 else{const c=loadCopySource(seen.target,f.repo),h=await startAwos(c);try{const queue=await h.client.call('queue');assert.equal(queue.items.length,1);assert.equal(queue.items[0].status,'approval');}finally{await h.close();}}
 // SIGKILL cannot retain the cooperative pair lock or damage the original.
 assert.ok((await create(f)).verified.reviews>=1);
});
for(const mode of ['unknown','committed'])test(`restoring ${mode} preserves C6, fake receipt and approval without redispatch`,{timeout:15_000},async t=>{
 const f=await copyFixture(t);await f.stop();const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--import','tsx',join(process.cwd(),'test/helpers/awos-copy-effects.mjs'),f.root,f.repo,mode],{cwd:f.repo,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);assert.equal((await once(child,'exit'))[0],0,stderr);const before=JSON.parse(stdout.trim());assert.equal(before.status,mode==='unknown'?'unknown':'completed');assert.ok(before.effects.length>0);
 const copy=await create(f);assert.equal(copy.verified.fakeCalls,1);assert.equal(copy.verified.fakeReceipts,1);assert.equal(copy.verified.unknown,mode==='unknown'?1:0);
 const restored=await restoreAwosCopy({path:copy.path,repo:f.repo,port:await freePort()});t.after(()=>rmSync(restored.root,{recursive:true,force:true}));assert.equal(restored.verified.unknown,copy.verified.unknown);assert.equal(restored.verified.fakeCalls,1);assert.equal(restored.verified.fakeReceipts,1);
 const c=loadCopySource(restored.root,f.repo),h=await startAwos(c);try{const v=await h.client.call('view',before.taskId);assert.equal(v.status,before.status);assert.deepEqual(v.effects,before.effects);assert.equal(v.runtimeReplacement.canReplace,false);await assert.rejects(h.client.call('replace',before.taskId,{requestId:randomUUID(),bindingHash:v.review.bindingHash,replacementTaskId:before.taskId+'-new',to:'elena@example.test',subject:'New',body:'New',contactId:'qa-elena'}),/C6_CLAIM/);}finally{await h.close();}
});
test('an occupied source port is refused without sending HTTP requests or stopping its owner',async t=>{
 const f=await copyFixture(t);await f.stop();let connections=0;const server=createServer(socket=>{connections++;socket.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;t.after(()=>server.close());const connected=once(server,'connection');await assert.rejects(createAwosCopy({config:{...f.config,port},repo:f.repo,output:f.output}),/SERVER_RUNNING/);await connected;assert.equal(connections,1);assert.ok(server.listening);
});
test('a committed fake effect without its receipt is rejected instead of creating a resendable restore',async t=>{
 const f=await copyFixture(t);await f.stop();const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--import','tsx',join(process.cwd(),'test/helpers/awos-copy-effects.mjs'),f.root,f.repo,'committed'],{cwd:f.repo,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);assert.equal((await once(child,'exit'))[0],0,stderr);
 const copy=await create(f),name='runtime/runtime.db.fake-email.db',db=new DatabaseSync(join(copy.path,name));db.exec('DELETE FROM receipts; DELETE FROM calls');db.close();rehash(copy.path,name);await assert.rejects(restoreAwosCopy({path:copy.path,repo:f.repo,port:await freePort()}),/REPLAY_OR_PAIR_INVALID/);
});
test('a durable command with no runtime task restores pending, without inventing review or approval',async t=>{
 const f=await copyFixture(t),i=initial(),flow=createAwosFlow(f.db,f.host.client,{hook:stage=>{if(stage==='recorded')throw Error('CRASH_BEFORE_CREATE');}});await assert.rejects(flow.prepare(i),/CRASH_BEFORE_CREATE/);await f.stop();const copy=await create(f);assert.equal(copy.verified.pending,1);assert.equal(copy.verified.reviews,0);assert.equal(copy.verified.decisions,0);
 const restored=await restoreAwosCopy({path:copy.path,repo:f.repo,port:await freePort()});t.after(()=>rmSync(restored.root,{recursive:true,force:true}));assert.equal(restored.verified.pending,1);
 const c=loadCopySource(restored.root,f.repo),h=await startAwos(c),db=openDb(join(c.dataDir,'pyme1.db'));try{const flow=createAwosFlow(db,h.client),rows=await flow.list();assert.equal(rows[0].state,'blocked');assert.equal(rows[0].remote,null);const r=await flow.resume(i.opId,1);assert.equal(r.state,'approval');assert.equal(r.remote.decision,null);}finally{await h.close();db.close();}
});
for(const loss of ['before-decision','after-decision'])test(`copy of a pending ${loss} intent neither approves nor repeats a decision on restore`,async t=>{
 const f=await copyFixture(t),i=initial();let lost=false;const client={call:async(...args)=>{const r=await f.host.client.call(...args);if(loss==='after-decision'&&args[0]==='decision'&&!lost){lost=true;throw Error('LOST_DECISION_RESPONSE');}return r;}};
 const flow=createAwosFlow(f.db,client,{hook:stage=>{if(loss==='before-decision'&&stage==='decision-pending')throw Error('CRASH_BEFORE_DECISION');}}),v=await flow.prepare(i);await assert.rejects(flow.decide(i.opId,1,{commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'approved'}));await f.stop();const copy=await create(f);assert.equal(copy.verified.decisions,loss==='after-decision'?1:0);
 const restored=await restoreAwosCopy({path:copy.path,repo:f.repo,port:await freePort()});t.after(()=>rmSync(restored.root,{recursive:true,force:true}));assert.equal(restored.verified.decisions,copy.verified.decisions);assert.equal(restored.verified.fakeCalls,0);
 const c=loadCopySource(restored.root,f.repo),h=await startAwos(c),db=openDb(join(c.dataDir,'pyme1.db'));try{const flow=createAwosFlow(db,h.client),before=await flow.get(i.opId,1);assert.equal(before.state,loss==='after-decision'?'ready':'approval');assert.equal(before.remote.review.bindingHash,v.remote.review.bindingHash);if(loss==='after-decision'){const old=before.remote.decision,again=await flow.resume(i.opId,1);assert.deepEqual(again.remote.decision,old);assert.equal(again.remote.audit.filter(a=>a.type==='approval.approved').length,1);}}finally{await h.close();db.close();}
});
test('inspection rejects noncanonical WAL headers before a read-only opener can create auxiliary files',async t=>{
 const f=await copyFixture(t);await f.stop();const copy=await create(f),name='data/pyme1.db',bytes=readFileSync(join(copy.path,name));bytes[18]=2;bytes[19]=2;writeFileSync(join(copy.path,name),bytes);rehash(copy.path,name);assert.throws(()=>inspectAwosCopy(copy.path),/SQLITE_FORMAT/);assert.deepEqual(readdirSync(join(copy.path,'data')),['pyme1.db']);
});
