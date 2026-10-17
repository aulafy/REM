import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/awos-harness.js';
import {saveSettings} from '../src/settings.js';
import {renderProposal} from '../src/proposal-templates.js';

test('REM language metadata survives AWOS restart; settings switch preserves exact review, binding, versions and no effects',async()=>{
 const f=await fixture();try{
  const template=f.db.proposalTemplates.create({language:'en',nombre:'Synthetic quote',asunto:'Quote for {{cliente}}',cuerpo:'{{servicio}}: {{importe}}'}),variables={cliente:'Elena Soler',servicio:'Synthetic review',importe:'1250.50',plazo:'15 days',validez:'30 days',condiciones:'Review only'};
  const rendered=renderProposal(template,variables,{language:'en'}),input={opId:randomUUID(),commandId:randomUUID(),expectedVersion:0,contactId:'qa-elena',request:'Prepare the synthetic proposal for 1250.50 EUR.',subject:rendered.subject,body:rendered.body,template:{templateId:template.id,templateVersion:1,variables:rendered.variables,language:'en'}};
  const original=await f.flow().prepare(input);assert.equal(original.state,'approval');assert.equal(original.template.language,'en');const binding=original.remote.review.bindingHash,payload=structuredClone(original.remote.review.payload);
  saveSettings(f.db,{language:'es'});await f.restart();const recovered=await f.flow().resume(input.opId,1);assert.deepEqual(recovered.template,original.template);assert.deepEqual(recovered.remote.review.payload,payload);assert.equal(recovered.remote.review.bindingHash,binding);assert.deepEqual(recovered.remote.effects,[]);assert.equal((await f.flow().prepare(input)).taskId,original.taskId);
  await assert.rejects(f.flow().prepare({...input,template:{...input.template,language:'es'}}),/COMMAND_CONFLICT/);assert.equal((await f.flow().list()).length,1);
 }finally{await f.close();}
});
