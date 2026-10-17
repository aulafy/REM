import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/awos-harness.js';import {createAwosFlow} from '../src/awos-flow.js';
const first=()=>({opId:randomUUID(),commandId:randomUUID(),expectedVersion:0,contactId:'qa-elena',request:'Agradece a Elena su ayuda.',subject:'Gracias',body:'Gracias por tu ayuda.'});
test('three durable versions keep one CRM opportunity and make previous approvals unusable',async()=>{
 const f=await fixture();try{const flow=f.flow(),i=first();let v=await flow.prepare(i);
  for(let version=2;version<=3;version++){await flow.decide(i.opId,version-1,{commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'approved'});v=await flow.prepare({...i,expectedVersion:version-1,commandId:randomUUID(),body:'Versión '+version});assert.equal(v.version,version);assert.equal(v.state,'approval');assert.equal(v.remote.runtimeReplacement.version,version);}
  const rows=await flow.list();assert.deepEqual(rows.map(r=>r.state),['approval','cancelled','cancelled']);
  const crm=await f.host.client.call('crm','qa-elena');assert.equal(crm.leads.length,1);assert.equal(crm.interactions.length,0);assert.equal(crm.followUps.length,0);
  await f.restart();assert.equal((await f.flow().get(i.opId,1)).state,'cancelled');assert.equal((await f.flow().get(i.opId,3)).state,'approval');
 }finally{await f.close();}
});
test('lost replacement receipt is recovered by repeating the same durable request, never creating an unlinked task',async()=>{
 const f=await fixture();try{const original=f.host.client;let posts=0,lose=true;const c={call:async(...args)=>{const out=await original.call(...args);if(args[0]==='replace'){posts++;if(lose){lose=false;throw Error('LOST_REPLACE_RESPONSE');}}return out;}};
  const flow=createAwosFlow(f.db,c),i=first(),v=await flow.prepare(i);const next={...i,expectedVersion:1,commandId:randomUUID(),body:'Corrected'};
  await assert.rejects(flow.prepare(next),/LOST_REPLACE_RESPONSE/);assert.equal((await flow.get(i.opId,1)).state,'cancelled');await f.restart();const recovered=await f.flow().resume(i.opId,2);assert.equal(recovered.state,'approval');assert.equal(recovered.remote.review.payload.body,'Corrected');assert.equal((await f.flow().list()).length,2);assert.equal(posts,1);
  assert.equal((await f.host.client.call('crm','qa-elena')).leads.length,1);
 }finally{await f.close();}
});
test('replacement preserves original contact and legacy unlinked versions are never presented as durable replacements',async()=>{
 const f=await fixture();try{const flow=f.flow(),i=first();await flow.prepare(i);
  await assert.rejects(flow.prepare({...i,expectedVersion:1,commandId:randomUUID(),contactId:'qa-luis'}),/SCOPE_CHANGED/);
  assert.equal((await flow.get(i.opId,1)).state,'approval');
  // Emulate the additive pre-replacement schema: retain old history, never relink silently.
  f.db.run('INSERT INTO awos_ops (op_id,version,command_id,identity_hash,task_id,contact_id,request,payload,stage,created_at) SELECT op_id,2,?,identity_hash,?,contact_id,request,payload,stage,created_at FROM awos_ops WHERE op_id=? AND version=1',randomUUID(),`p1-${i.opId}-v2`,i.opId);
  await assert.rejects(flow.resume(i.opId,2),/LEGACY_VERSION_UNLINKED/);await assert.rejects(flow.decide(i.opId,2,{commandId:randomUUID(),bindingHash:(await flow.get(i.opId,1)).remote.review.bindingHash,decision:'approved'}),/LEGACY_VERSION_UNLINKED/);assert.equal((await flow.get(i.opId,1)).remote.runtimeReplacement.replacementTaskId,null);
 }finally{await f.close();}
});
