import test from 'node:test';import assert from 'node:assert/strict';
import {runtimeReplacementFixture} from './fixtures/runtime-mail-replacement-fixture.js';
import {parseEmailView} from '../src/email-view.js';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';

for(const decision of [undefined,'approved','rejected'] as const)test(`runtime replacement ${decision??'before approval'}: old blocked, exact history and one CRM opportunity`,async()=>{
 const f=await runtimeReplacementFixture();try{
  const original=await f.create('root',decision),input=f.input(),result=await f.post('root','replace',input);assert.equal(result.status,200);
  const old=f.runtime.source.email!.view('root',f.owner);assert.equal(old.status,'cancelled');assert.equal(old.decision?.decision,decision);assert.equal(old.runtimeReplacement!.replacementTaskId,'next');assert.equal(old.runtimeReplacement!.canReplace,false);
  assert.equal(f.runtime.kernel.snapshot().workUnits['root-p1-s7']!.status,'cancelled');
  for(const op of ['draft','review','decision','execute']){const b=op==='draft'?{to:input.to,subject:input.subject,body:input.body,contactId:input.contactId}:op==='decision'?{bindingHash:original.review!.bindingHash,decision:'approved'}:{};assert.notEqual((await f.post('root',op,b)).status,200);}
  const next=f.runtime.source.email!.view('next',f.owner);assert.equal(next.review,null);assert.equal(next.decision,null);assert.equal(next.draft!.body,input.body);assert.equal(next.runtimeReplacement!.previousTaskId,'root');
  const r=await f.runtime.source.email!.propose('next',f.owner);assert.notEqual(r.review!.bindingHash,original.review!.bindingHash);assert.equal(r.decision,null);
  assert.notEqual((await f.post('next','decision',{bindingHash:original.review!.bindingHash,decision:'approved'})).status,200);
  assert.notEqual((await f.post('next','execute',{})).status,200);
  const crm=f.runtime.source.crm!.view(f.tenant,f.owner,'','contact','all');assert.equal(crm.leads.length,1);assert.equal(crm.followUps.length,0);assert.equal(crm.interactions.filter(i=>i.direction==='outgoing').length,0);assert.deepEqual(f.counts(),{calls:0,receipts:0});
  const before=JSON.stringify(f.runtime.kernel.snapshot());await f.reopen();assert.equal(JSON.stringify(f.runtime.kernel.snapshot()),before);assert.equal(f.runtime.source.email!.view('root',f.owner).status,'cancelled');
 }finally{await f.done();}
});
test('request receipt is idempotent after restart; altered request, stale binding and target collision do not publish branches',async()=>{
 const f=await runtimeReplacementFixture();try{
  await f.create('root','approved');const input=f.input();
  assert.notEqual((await f.post('root','replace',{...input,bindingHash:'a'.repeat(64)})).status,200);assert.equal(f.runtime.source.email!.view('root',f.owner).status,'approved');
  const one=await f.post('root','replace',input);await f.reopen();assert.deepEqual(await f.post('root','replace',input),one);
  for(const changed of [{...input,body:'different'},{...input,requestId:'another',replacementTaskId:'branch'}])assert.notEqual((await f.post('root','replace',changed)).status,200);
  assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,2);
  await f.create('independent');const collision=f.input('independent','next');assert.notEqual((await f.post('independent','replace',collision)).status,200);assert.notEqual(f.runtime.source.email!.view('independent',f.owner).status,'cancelled');
 }finally{await f.done();}
});
test('replacement cannot change owner/tenant/contact/recipient or accept actor/execution authority',async()=>{
 const f=await runtimeReplacementFixture();try{await f.create('root','approved');const input=f.input();
  for(const [token,tenant]of [['other-token-123456789',f.tenant],['reviewer-token-123456789',f.tenant],['owner-token-123456789','foreign']])assert.notEqual((await f.post('root','replace',input,token,tenant)).status,200);
  for(const b of [{...input,actor:'other'},{...input,execute:true},{...input,contactId:'other-contact',to:'other@example.test'},{...input,to:'external@example.test'}])assert.notEqual((await f.post('root','replace',b)).status,200);
  assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);assert.equal(f.runtime.source.email!.view('root',f.owner).status,'approved');
 }finally{await f.done();}
});
for(const mode of ['unknown','committed','certified-failed'] as const)test(`C6 ${mode} blocks replacement without hiding evidence or redispatch`,async()=>{
 const f=await runtimeReplacementFixture({loseResponse:mode==='unknown',rejectBeforeSend:mode==='certified-failed'});try{await f.create('root','approved');const input=f.input();await f.post('root','execute',{});const before=f.runtime.source.email!.view('root',f.owner);assert.ok(before.effects.length>0);assert.equal(before.status,mode==='committed'?'completed':mode==='certified-failed'?'failed':'unknown');
  const r=await f.post('root','replace',input);assert.equal(r.status,409);assert.equal(r.body.error,'EMAIL_REPLACE_C6_CLAIM');assert.deepEqual(f.runtime.source.email!.view('root',f.owner).effects,before.effects);assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);
 }finally{await f.done();}
});
for(const mode of ['active','unknown','finished'] as const)test(`${mode} external attempt without C6 blocks replacement`,async()=>{
 const f=await runtimeReplacementFixture();try{await f.create('root','approved');const input=f.input(),kernel=f.runtime.kernel,at=Date.now();for(const e of [{type:'AttemptCreated',workUnitId:'root-p1-s7',attemptId:'active',providerId:'external',actorId:f.owner,dispatchFingerprint:'fingerprint'},{type:'AttemptReserved',attemptId:'active'},{type:'AttemptDispatchStarted',attemptId:'active'}])kernel.apply({id:crypto.randomUUID(),taskId:'root',at,...e} as never,kernel.snapshot().revision);
  if(mode==='unknown')kernel.apply({id:crypto.randomUUID(),taskId:'root',at,type:'AttemptUnknown',attemptId:'active'},kernel.snapshot().revision);
  if(mode==='finished'){
   for(const e of [{type:'AttemptProviderReported',attemptId:'active',outcome:'failed'},{type:'VerificationStarted',attemptId:'active'},{type:'EvidenceRecorded',referenceId:'external-proof',attemptId:'active'},{type:'VerificationCompleted',attemptId:'active',results:[{criterionId:'root-p1-s7-evidence',status:'unsatisfied',evidenceRefs:['external-proof']}]}])kernel.apply({id:crypto.randomUUID(),taskId:'root',at,...e} as never,kernel.snapshot().revision);
  }
  const r=await f.post('root','replace',input);assert.equal(r.body.error,mode==='unknown'?'EMAIL_REPLACE_UNKNOWN':mode==='finished'?'EMAIL_REPLACE_EXTERNAL_DISPATCH':'EMAIL_REPLACE_ACTIVE_ATTEMPT');assert.notEqual(kernel.snapshot().tasks.root!.status,'cancelled');assert.equal(Object.keys(kernel.snapshot().tasks).length,1);if(mode==='unknown')assert.equal(f.runtime.source.email!.view('root',f.owner).status,'unknown');
 }finally{await f.done();}
});
test('only the freshly approved successor may execute; retries and cancelled predecessor never duplicate fake dispatch',async()=>{
 const f=await runtimeReplacementFixture();try{await f.create('root','approved');await f.post('root','replace',f.input());const r=await f.runtime.source.email!.propose('next',f.owner);await f.runtime.source.email!.decide('next',f.owner,{bindingHash:r.review!.bindingHash,decision:'approved'});
  assert.equal((await f.post('next','execute',{})).status,200);await f.post('next','execute',{});assert.notEqual((await f.post('root','execute',{})).status,200);assert.deepEqual(f.counts(),{calls:1,receipts:1});const crm=f.runtime.source.crm!.view(f.tenant,f.owner,'','contact','all');assert.equal(crm.leads.length,1);assert.equal(crm.interactions.filter(i=>i.direction==='outgoing').length,1);assert.equal(crm.followUps.length,1);
 }finally{await f.done();}
});
test('a multi-version chain reuses one lead and authoritative metadata; malformed controls fail parsing',async()=>{
 const f=await runtimeReplacementFixture();try{await f.create('root','approved');let id='root';
  for(let version=2;version<=4;version++){const next='version-'+version;const r=await f.post(id,'replace',f.input(id,next));assert.equal(r.status,200);await f.runtime.source.email!.propose(next,f.owner);const v=f.runtime.source.email!.view(next,f.owner);assert.equal(v.runtimeReplacement!.version,version);assert.equal(v.runtimeReplacement!.rootTaskId,'root');parseEmailView({tenantId:f.tenant,...v},f.tenant,next);assert.throws(()=>parseEmailView({tenantId:f.tenant,...v,runtimeReplacement:{...v.runtimeReplacement,canReplace:'yes'}},f.tenant,next));id=next;}
  assert.equal(f.runtime.source.crm!.view(f.tenant,f.owner,'','contact','all').leads.length,1);assert.deepEqual(f.counts(),{calls:0,receipts:0});
  const queue=f.runtime.source.reviews!.list(f.owner,{filter:'all',query:'',limit:25,cursor:null});assert.equal(queue.items.find(r=>r.taskId===id)!.revision,4);assert.equal(queue.counts.cancelled,3);assert.equal(queue.counts.approval,1);
 }finally{await f.done();}
});
test('transaction failure after cancelling parent requires recovery and rolls back link, task and CRM changes',async()=>{
 let fail=true;const f=await runtimeReplacementFixture({hooks:{afterParentCancelled:()=>{if(fail)throw Error('SYNTHETIC_FAILURE');}}});try{await f.create('root','approved');const input=f.input();assert.notEqual((await f.post('root','replace',input)).status,200);assert.throws(()=>f.runtime.source.email!.view('root',f.owner),/NOT_READY/);fail=false;await f.reopen();assert.equal(f.runtime.source.email!.view('root',f.owner).status,'approved');assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);assert.equal(f.runtime.source.crm!.view(f.tenant,f.owner,'','contact','all').leads.length,1);assert.equal((await f.post('root','replace',input)).status,200);
 }finally{await f.done();}
});
test('two replacements, a competing decision and execute cannot create a branch or cancel an active send',async()=>{
 const f=await runtimeReplacementFixture();try{await f.create('root','approved');const input=f.input();const out=await Promise.all([f.post('root','replace',input),f.post('root','replace',{...input,requestId:'second',replacementTaskId:'branch'})]);assert.equal(out.filter(r=>r.status===200).length,1);assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,2);assert.deepEqual(f.counts(),{calls:0,receipts:0});
  await f.create('racing','approved');const request=f.input('racing','racing-next');const race=await Promise.all([f.post('racing','execute',{}),f.post('racing','replace',request)]);assert.notEqual(race[1]!.status,200);assert.equal(f.runtime.source.email!.view('racing',f.owner).status,'completed');assert.equal(f.runtime.kernel.snapshot().tasks['racing-next'],undefined);
 }finally{await f.done();}
});
test('successor cannot change the inherited contact or recipient before review',async()=>{
 const f=await runtimeReplacementFixture();try{await f.create();await f.post('root','replace',f.input());const bad=await f.post('next','draft',{to:'other@example.test',subject:'Wrong recipient',body:'Changed',contactId:'other-contact'});assert.notEqual(bad.status,200);const next=f.runtime.source.email!.view('next',f.owner);assert.equal(next.review,null);assert.equal(next.draft!.contactId,'contact');
 }finally{await f.done();}
});
for(const phase of ['before','inside','after'])test(`SIGKILL ${phase} runtime replacement commit: atomic link, cancellation, draft and CRM`,{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'runtime-replace-crash-'));let f=await runtimeReplacementFixture({dir});
 try{await f.create('root','approved');const input=f.input();await f.done();
  const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('./fixtures/runtime-mail-replacement-crash.ts',import.meta.url)),dir,phase,JSON.stringify(input)],{stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);const [code,signal]=await once(child,'exit');assert.equal(code,null,stderr);assert.equal(signal,'SIGKILL');
  f=await runtimeReplacementFixture({dir});const old=f.runtime.source.email!.view('root',f.owner),committed=phase==='after';assert.equal(old.status,committed?'cancelled':'approved');assert.equal(old.runtimeReplacement!.replacementTaskId,committed?'next':null);assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,committed?2:1);
  assert.equal(f.runtime.source.crm!.view(f.tenant,f.owner,'','contact','all').leads.length,1);
  const receipt=await f.post('root','replace',input);assert.equal(receipt.status,200);const next=f.runtime.source.email!.view('next',f.owner);assert.equal(next.review,null);assert.equal(next.draft!.body,input.body);assert.deepEqual(f.counts(),{calls:0,receipts:0});
  const count=f.runtime.kernel.snapshot().revision;assert.deepEqual(await f.post('root','replace',input),receipt);assert.equal(f.runtime.kernel.snapshot().revision,count);
 }finally{await f.done();rmSync(dir,{recursive:true,force:true});}
});
