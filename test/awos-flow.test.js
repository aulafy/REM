import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/awos-harness.js';
const input=()=>({opId:randomUUID(),commandId:randomUUID(),expectedVersion:0,contactId:'qa-elena',request:'Agradece a Elena su ayuda.',subject:'Gracias',body:'Gracias por tu ayuda, Elena.'});
test('AWOS real: revisión, aprobación exacta, contactos estables, historial y versiones sin efectos',async()=>{
 const f=await fixture();try{
  const flow=f.flow(),i=input(),v=await flow.prepare(i);assert.equal(v.state,'approval');assert.equal(v.remote.simulated,true);assert.deepEqual(v.remote.effects,[]);
  const a={commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'approved'};
  const approved=await flow.decide(i.opId,1,a);assert.equal(approved.state,'ready');assert.deepEqual(approved.remote.effects,[]);
  const repeat=await flow.decide(i.opId,1,a);assert.equal(repeat.remote.decision.id,approved.remote.decision.id);
  await assert.rejects(flow.decide(i.opId,1,{...a,decision:'rejected'}),/CONFLICT/);
  const edit=await flow.prepare({...i,expectedVersion:1,commandId:randomUUID(),body:'Gracias de nuevo, Elena.'});assert.equal(edit.version,2);assert.equal(edit.state,'approval');assert.equal(edit.remote.decision,null);
  const old=await flow.get(i.opId,1);assert.equal(old.state,'cancelled');assert.equal(old.remote.decision.decision,'approved');assert.equal(old.remote.runtimeReplacement.replacementTaskId,edit.taskId);assert.equal(old.latest,false);
  await assert.rejects(flow.decide(i.opId,2,a),/REVIEW_CHANGED/);
  assert.equal((await flow.contacts()).length,2);assert.equal(f.db.proposals.pending().length,0);
 }finally{await f.close();}
});
test('idempotencia y conflictos de operación; revisión bloquea saveDraft en la misma tarea',async()=>{
 const f=await fixture();try{const flow=f.flow(),i=input(),v=await flow.prepare(i);const again=await flow.prepare(i);assert.equal(again.taskId,v.taskId);assert.equal(again.remote.review.id,v.remote.review.id);
  await assert.rejects(flow.prepare({...i,body:'Otro texto'}),/COMMAND_CONFLICT/);
  await assert.rejects(f.host.client.call('draft',v.taskId,{...v.desired,body:'No permitido'}),/EMAIL_OPERATION_NOT_CONFIRMED/);
  const outcomes=await Promise.allSettled([flow.prepare({...i,expectedVersion:1,commandId:randomUUID(),body:'Versión A'}),flow.prepare({...i,expectedVersion:1,commandId:randomUUID(),body:'Versión B'})]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 }finally{await f.close();}
});
test('dos pestañas y decisión contraria; una sola decisión durable',async()=>{
 const f=await fixture();try{const flow=f.flow(),i=input(),v=await flow.prepare(i),base={bindingHash:v.remote.review.bindingHash,commandId:randomUUID()};
  const out=await Promise.allSettled([flow.decide(i.opId,1,{...base,decision:'approved'}),flow.decide(i.opId,1,{...base,decision:'rejected'})]);assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await flow.get(i.opId,1)).remote.audit.filter(a=>a.type.startsWith('approval.')).length,1);
 }finally{await f.close();}
});
test('respuesta de decisión perdida: recuperación consulta y no repite POST comprometido',async()=>{
 const f=await fixture();try{let posts=0,lose=true;const original=f.host.client;const client={call:async(...args)=>{if(args[0]==='decision'){posts++;const v=await original.call(...args);if(lose){lose=false;throw Error('LOST_RESPONSE');}return v;}return original.call(...args);}};
  const {createAwosFlow}=await import('../src/awos-flow.js');const flow=createAwosFlow(f.db,client),i=input(),v=await flow.prepare(i);
  await assert.rejects(flow.decide(i.opId,1,{commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'rejected'}),/LOST_RESPONSE/);
  await f.restart();const resumed=await f.flow().resume(i.opId,1);assert.equal(resumed.remote.decision.decision,'rejected');assert.equal(posts,1);assert.deepEqual(resumed.remote.effects,[]);
 }finally{await f.close();}
});
test('motor caído produce error real y no propuestas locales',async()=>{
 const f=await fixture();try{await f.host.close();await assert.rejects(f.flow().prepare(input()),/AWOS_UNAVAILABLE/);assert.equal(f.db.proposals.pending().length,0);}finally{await f.close();}
});
for(const phase of ['draft','review'])test(`respuesta perdida tras ${phase}: relectura recupera sin duplicar escritura`,async()=>{
 const f=await fixture();try{const original=f.host.client;let posts=0,lose=true;const client={call:async(...args)=>{const result=await original.call(...args);if(args[0]===phase){posts++;if(lose){lose=false;throw Error('LOST_RESPONSE');}}return result;}};
  const {createAwosFlow}=await import('../src/awos-flow.js');const flow=createAwosFlow(f.db,client),i=input();await assert.rejects(flow.prepare(i),/LOST_RESPONSE/);
  const recovered=await flow.resume(i.opId,1);assert.equal(recovered.state,'approval');assert.equal(recovered.remote.review.payload.body,i.body);assert.equal(posts,1);assert.equal(recovered.remote.audit.filter(a=>a.type==='plan.bound').length,1);
 }finally{await f.close();}
});
test('petición de decisión perdida antes de llegar: intención durable permite repetir solo la misma',async()=>{
 const f=await fixture();try{let lost=true;const original=f.host.client,client={call:async(...args)=>{if(args[0]==='decision'&&lost){lost=false;throw Error('BEFORE_POST');}return original.call(...args);}};
  const {createAwosFlow}=await import('../src/awos-flow.js');const flow=createAwosFlow(f.db,client),i=input(),v=await flow.prepare(i);await assert.rejects(flow.decide(i.opId,1,{commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'approved'}),/BEFORE_POST/);
  const r=await flow.resume(i.opId,1);assert.equal(r.remote.decision.decision,'approved');assert.equal(r.remote.audit.filter(a=>a.type==='approval.approved').length,1);
 }finally{await f.close();}
});
