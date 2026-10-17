import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {launch,tenant,owner} from './fixtures/pyme1-harness.js';
import {DatabaseSync} from 'node:sqlite';
test('Pyme_1 host: contratos reales, recuperación, aprobación exacta y cero efectos',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pyme1-awos-contract-')),token='synthetic-contract-token-123456';let f=await launch(dir,token);
 const task='p1-'+randomUUID()+'-v1',payload={to:'elena@example.test',subject:'Gracias',body:'Gracias por tu ayuda.',contactId:'qa-elena'};
 const call=async(method:string,path:string,body?:unknown,authorization=token)=>{const r=await fetch(`http://127.0.0.1:${f.port}/v1/workspaces/${tenant}${path}`,{method,headers:{authorization:'Bearer '+authorization,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json() as Record<string,any>};};
 try{
  assert.equal((await call('GET','/crm',undefined,'wrong')).status,401);
  const c=await call('POST','/runtime',{id:task,goal:'Preparar correo sintético '+task});assert.equal(c.status,201);
  assert.equal((await call('POST',`/runtime/${task}/email/draft`,payload)).body.error,'EMAIL_OPERATION_NOT_CONFIRMED');
  assert.equal((await call('POST',`/runtime/${task}/plan`,{workflow:'email-lead-v1'})).status,201);
  const draft=await call('POST',`/runtime/${task}/email/draft`,payload);assert.equal(draft.body.status,'plan_ready');assert.equal(draft.body.draft.body,payload.body);
  const reviewed=await call('POST',`/runtime/${task}/email/review`,{});assert.equal(reviewed.body.status,'waiting_approval');assert.equal(reviewed.body.review.owner,owner);assert.equal(reviewed.body.draft,undefined);
  assert.equal((await call('POST',`/runtime/${task}/email/draft`,payload)).body.error,'EMAIL_OPERATION_NOT_CONFIRMED');
  const bindingHash=reviewed.body.review.bindingHash;
  const a=await call('POST',`/runtime/${task}/email/decision`,{bindingHash,decision:'approved'});assert.equal(a.body.status,'approved');assert.equal(a.body.decision.userId,owner);assert.deepEqual(a.body.effects,[]);
  assert.equal((await call('POST',`/runtime/${task}/email/decision`,{bindingHash,decision:'rejected'})).body.error,'EMAIL_OPERATION_NOT_CONFIRMED');
  assert.equal((await call('GET','/review-queue?filter=all')).body.items[0].status,'ready');
  for(const op of ['execute','reconcile','cancel','revise','reprepare'])assert.equal((await call('POST',`/runtime/${task}/email/${op}`,{})).status,404);
  const snapshot=f.runtime.kernel.snapshot();
  assert.ok(Object.values(snapshot.attempts).every(a=>!String(a.workUnitId).endsWith('-s7')),'no send step started; review has legitimate local attempts');
  const outbox=new DatabaseSync(join(dir,'runtime.db.fake-email.db'),{readOnly:true});
  try{assert.equal((outbox.prepare('SELECT COUNT(*) AS n FROM calls').get() as {n:number}).n,0);assert.equal((outbox.prepare('SELECT COUNT(*) AS n FROM receipts').get() as {n:number}).n,0);}finally{outbox.close();}
  const journal=new DatabaseSync(join(dir,'runtime.db'),{readOnly:true});
  try{assert.equal((journal.prepare("SELECT COUNT(*) AS n FROM store_commands WHERE store_name='effects'").get() as {n:number}).n,0,'no C6 claim recorded');}finally{journal.close();}
  await f.close();f=await launch(dir,'new-synthetic-session-token-123456');
  assert.equal((await call('GET',`/runtime/${task}/email`)).status,401,'old session never survives restart');
  const r=await call('GET',`/runtime/${task}/email`,undefined,'new-synthetic-session-token-123456');assert.equal(r.body.decision.id,a.body.decision.id);assert.deepEqual(r.body.effects,[]);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
