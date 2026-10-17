import {validLanguage} from './language.js';
import {followupOperationIds,followupStop} from './awos-followups.js';
// Durable orchestration only. Approval and history are always read back from AWOS.
import {createHash} from 'node:crypto';
import {AwosError} from './awos-client.js';
import {unexpectedDates,draftingDateReferences} from './draft-dates.js';
import {unexpectedNumbers} from './numbers.js';
import {validateVariables} from './proposal-templates.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const EMAIL_STATES={plan_ready:'draft',waiting_approval:'approval',approved:'ready',unknown:'uncertain',blocked:'blocked',running:'running',failed:'failed',completed:'completed',cancelled:'cancelled',rejected:'rejected'};
export function displayState(view){return EMAIL_STATES[view.status]??'blocked';}
function samePayload(actual,wanted){return actual&&actual.from==='office@example.test'&&JSON.stringify(actual.to)==JSON.stringify([wanted.to])&&actual.cc?.length===0&&actual.bcc?.length===0&&actual.subject===wanted.subject&&actual.body===wanted.body&&actual.contactId===wanted.contactId;}
export function createAwosFlow(db,client,{hook=()=>{},onSupersede=()=>{}}={}){
 db.run('PRAGMA synchronous=FULL');
 db.run(`CREATE TABLE IF NOT EXISTS awos_ops (op_id TEXT NOT NULL, version INTEGER NOT NULL, command_id TEXT NOT NULL UNIQUE, identity_hash TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE, contact_id TEXT NOT NULL, request TEXT NOT NULL, payload TEXT NOT NULL, stage TEXT NOT NULL, decision_intent TEXT, created_at TEXT NOT NULL, PRIMARY KEY(op_id,version))`);
 const columns=new Set(db.all('PRAGMA table_info(awos_ops)').map(c=>c.name));
 for(const name of ['parent_task_id','parent_binding_hash','intake_command_id','followup_id'])if(!columns.has(name))db.run(`ALTER TABLE awos_ops ADD COLUMN ${name} TEXT`);
 db.run(`CREATE TABLE IF NOT EXISTS awos_op_templates (op_id TEXT NOT NULL, version INTEGER NOT NULL, template_id TEXT NOT NULL, template_version INTEGER NOT NULL, variables TEXT NOT NULL, PRIMARY KEY(op_id,version))`);
 const templateColumns=new Set(db.all('PRAGMA table_info(awos_op_templates)').map(c=>c.name));if(!templateColumns.has('language'))db.run('ALTER TABLE awos_op_templates ADD COLUMN language TEXT');
 const busy=new Set();
 const row=r=>r&&({...r,payload:JSON.parse(r.payload),decision_intent:r.decision_intent?JSON.parse(r.decision_intent):null});
 const all=()=>db.all('SELECT * FROM awos_ops ORDER BY created_at DESC,version DESC').map(row);
 const get=(op,version)=>row(db.all('SELECT * FROM awos_ops WHERE op_id=? AND version=?',op,version)[0]);
 const last=op=>db.all('SELECT MAX(version) AS n FROM awos_ops WHERE op_id=?',op)[0]?.n??0;
 async function locked(op,fn){if(busy.has(op))throw new AwosError('AWOS_BUSY');busy.add(op);try{return await fn();}finally{busy.delete(op);}}
 function mark(r,stage){db.run('UPDATE awos_ops SET stage=? WHERE op_id=? AND version=?',stage,r.op_id,r.version);hook(stage,r);}
 async function contact(id){const detail=await client.call('crm',id),c=detail.contacts?.find(c=>c.id===id&&c.status==='active'),ids=detail.identities?.filter(i=>i.active&&i.contactId===id);if(!c||!ids||ids.length!==1||!/^[^@\s]+@example\.test$/.test(ids[0].email))return null;return {...c,email:ids[0].email};}
 async function contacts(){const v=await client.call('crm');if(!Array.isArray(v.contacts))throw new AwosError('AWOS_RESPONSE_INVALID',502);const out=[];for(const c of v.contacts){const item=await contact(c.id);if(item)out.push(item);}return out;}

 function templateContext(r){const x=db.all('SELECT * FROM awos_op_templates WHERE op_id=? AND version=?',r.op_id,r.version)[0];return x?{templateId:x.template_id,templateVersion:x.template_version,variables:JSON.parse(x.variables),...(x.language?{language:x.language}:{})}:null;}
 async function view(r){const v=await client.call('view',r.task_id),base=new Date(r.created_at),p=v.review?.payload??v.draft,payload={asunto:p?.subject??'',texto:p?.body??''},template=templateContext(r),basis=template?[r.request,...Object.values(template.variables)].join('\n'):r.request;return {opId:r.op_id,version:r.version,taskId:r.task_id,latest:r.version===last(r.op_id),legacyUnlinked:r.version>1&&!r.parent_task_id,stage:r.stage,request:r.request,desired:r.payload,template,intakeCommandId:r.intake_command_id??null,followupId:r.followup_id??null,businessStop:followupStop(db,r.op_id,r.version),state:displayState(v),avisosFecha:unexpectedDates(basis,payload,base),avisos:unexpectedNumbers(basis,payload,draftingDateReferences(basis,base).map(d=>d.date)),remote:v};}
 async function resumeRow(r){
  if(r.version>1&&!r.parent_task_id)throw new AwosError('AWOS_LEGACY_VERSION_UNLINKED');
  if(r.parent_task_id){
   await client.call('replace',r.parent_task_id,{requestId:r.command_id,bindingHash:r.parent_binding_hash,replacementTaskId:r.task_id,...r.payload});mark(r,'replaced');
   onSupersede(r.op_id,r.version-1);
  }else{
   await client.call('create',null,{id:r.task_id,goal:'Preparar correo sintético '+r.task_id});mark(r,'created');
   await client.call('plan',r.task_id,{workflow:'email-lead-v1'});mark(r,'planned');
  }
  if(followupStop(db,r.op_id,r.version))throw new AwosError('AWOS_BUSINESS_STOPPED');
  if(r.followup_id&&!r.parent_task_id){
   const source=db.all('SELECT * FROM awos_followups WHERE id=?',r.followup_id)[0];if(!source)throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');
   for(let n=0;;n++){const w=(await client.call('crmWorkflow',source.task_id)).workflow;try{await client.call('crmCommand',null,{commandId:'p1-followup-'+r.command_id,expectedRevision:w.revision,operation:{type:'workflow.followup',id:r.task_id,sourceTaskId:source.task_id}});break;}catch(e){if(e.code!=='CRM_REVISION_CONFLICT'||n>=2)throw e;}}
  }
  let v=await client.call('view',r.task_id);
  if(r.parent_task_id&&(v.runtimeReplacement?.previousTaskId!==r.parent_task_id||v.runtimeReplacement.version!==r.version))throw new AwosError('AWOS_REPLACEMENT_PROOF_INVALID');
  if(v.review){if(!samePayload(v.review.payload,r.payload))throw new AwosError('AWOS_REVIEW_CONTENT_CONFLICT');}
  else {
   if(!samePayload(v.draft,r.payload)){await client.call('draft',r.task_id,r.payload);}mark(r,'draft');
   v=await client.call('review',r.task_id,{});
   if(!samePayload(v.review?.payload,r.payload))throw new AwosError('AWOS_REVIEW_CONTENT_CONFLICT');
  }
  if(followupStop(db,r.op_id,r.version))throw new AwosError('AWOS_BUSINESS_STOPPED');
  mark(r,'reviewed');return view(get(r.op_id,r.version));
 }
 async function prepare(input){
  if(!uuid(input.opId)||!uuid(input.commandId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw new AwosError('AWOS_INPUT_INVALID',400);
  if(typeof input.subject!=='string'||!input.subject.trim()||input.subject.length>200||/[\r\n]/.test(input.subject)||typeof input.body!=='string'||!input.body.trim()||input.body.length>6000||typeof input.request!=='string'||input.request.length>8000)throw new AwosError('AWOS_INPUT_INVALID',400);
  let tc=input.template;if(tc!==undefined){if(tc?.language!==undefined&&!validLanguage(tc.language))throw new AwosError('AWOS_INPUT_INVALID',400);if(!tc||!uuid(tc.templateId)||!Number.isSafeInteger(tc.templateVersion)||tc.templateVersion<1||!tc.variables||typeof tc.variables!=='object'||Array.isArray(tc.variables))throw new AwosError('AWOS_INPUT_INVALID',400);try{tc={...tc,variables:validateVariables(tc.variables)};}catch{throw new AwosError('AWOS_INPUT_INVALID',400);}}
  return locked(input.opId,async()=>{
   const c=await contact(input.contactId);if(!c)throw new AwosError('AWOS_CONTACT_INVALID',400);
   const payload={to:c.email,subject:input.subject,body:input.body,contactId:c.id};
   const origin=get(input.opId,input.expectedVersion),intakeCommandId=input.intakeCommandId??origin?.intake_command_id??null;
   if(intakeCommandId){if(!uuid(intakeCommandId)||origin&&intakeCommandId!==(origin.intake_command_id??null))throw new AwosError('AWOS_INTAKE_PROPOSAL_SCOPE');const intake=db.all('SELECT * FROM awos_intakes WHERE command_id=?',intakeCommandId)[0];if(!intake||intake.stage!=='linked'||intake.contact_id!==c.id)throw new AwosError('AWOS_INTAKE_PROPOSAL_SCOPE');}
   const followupId=input.followupId??origin?.followup_id??null;
   if(followupId){if(!uuid(followupId)||origin&&followupId!==(origin.followup_id??null))throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');const f=db.all('SELECT * FROM awos_followups WHERE id=?',followupId)[0],parent=f?get(f.op_id,f.version):null;if(!f||!parent||parent.contact_id!==c.id||followupOperationIds(f.id).opId!==input.opId)throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');}
   const identity=hash({opId:input.opId,expectedVersion:input.expectedVersion,request:input.request,payload,...(tc?{template:tc}:{}),...(intakeCommandId?{intakeCommandId}:{}),...(followupId?{followupId}:{})});
   const prior=row(db.all('SELECT * FROM awos_ops WHERE command_id=?',input.commandId)[0]);
   if(prior){if(prior.identity_hash!==identity)throw new AwosError('AWOS_COMMAND_CONFLICT');return resumeRow(prior);}
   const previous=get(input.opId,input.expectedVersion);let parentBinding=null;
   if(previous){
    if(previous.version>1&&!previous.parent_task_id)throw new AwosError('AWOS_LEGACY_VERSION_UNLINKED');
    if(previous.decision_intent&&previous.stage==='decision-pending')throw new AwosError('AWOS_DECISION_PENDING');
    const parent=await client.call('view',previous.task_id);
    if(!parent.review||!parent.runtimeReplacement?.canReplace||parent.effects.length)throw new AwosError('AWOS_REPLACEMENT_NOT_AVAILABLE');
    if(parent.review.payload.contactId!==payload.contactId||JSON.stringify(parent.review.payload.to)!==JSON.stringify([payload.to]))throw new AwosError('AWOS_REPLACEMENT_SCOPE_CHANGED');
    parentBinding=parent.review.bindingHash;
   }
   if(followupStop(db,input.opId,input.expectedVersion+1)||followupId&&followupStop(db,db.all('SELECT op_id FROM awos_followups WHERE id=?',followupId)[0].op_id,db.all('SELECT version FROM awos_followups WHERE id=?',followupId)[0].version))throw new AwosError('AWOS_BUSINESS_STOPPED');
   db.run('BEGIN IMMEDIATE');let r;
   try{
    if(last(input.opId)!==input.expectedVersion)throw new AwosError('AWOS_VERSION_CONFLICT');
    const version=input.expectedVersion+1,taskId=`p1-${input.opId}-v${version}`;
    db.run('INSERT INTO awos_ops (op_id,version,command_id,identity_hash,task_id,contact_id,request,payload,stage,created_at,parent_task_id,parent_binding_hash,intake_command_id,followup_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',input.opId,version,input.commandId,identity,taskId,c.id,input.request,JSON.stringify(payload),'recorded',new Date().toISOString(),previous?.task_id??null,parentBinding,intakeCommandId,followupId);
    if(tc)db.run('INSERT INTO awos_op_templates (op_id,version,template_id,template_version,variables,language) VALUES (?,?,?,?,?,?)',input.opId,version,tc.templateId,tc.templateVersion,JSON.stringify(tc.variables),tc.language??null);
    db.run('COMMIT');r=get(input.opId,version);
   }catch(e){db.run('ROLLBACK');throw e;}
   hook('recorded',r);return resumeRow(r);
  });
 }
 async function resume(op,version){return locked(op,async()=>{const r=get(op,version);if(!r)throw new AwosError('AWOS_OPERATION_NOT_FOUND',404);if(r.version>1&&!r.parent_task_id)throw new AwosError('AWOS_LEGACY_VERSION_UNLINKED');if(r.stage==='decision-pending')return decideRow(r,r.decision_intent);return resumeRow(r);});}
 async function decideRow(r,intent){
  const v=await client.call('view',r.task_id);
  if(followupStop(db,r.op_id,r.version))throw new AwosError('AWOS_BUSINESS_STOPPED');
  if(v.review?.bindingHash!==intent.bindingHash||!samePayload(v.review.payload,r.payload))throw new AwosError('AWOS_REVIEW_CHANGED');
  if(v.decision){if(v.decision.decision!==intent.decision)throw new AwosError('AWOS_DECISION_CONFLICT');mark(r,'decided');return view(get(r.op_id,r.version));}
  if(v.effects.length)throw new AwosError('AWOS_EFFECT_EXISTS');
  // Only an already durable, explicit human intention reaches this request.
  await client.call('decision',r.task_id,{bindingHash:intent.bindingHash,decision:intent.decision});mark(r,'decided');return view(get(r.op_id,r.version));
 }
 async function decide(op,version,input){
  if(!uuid(input.commandId)||!['approved','rejected'].includes(input.decision)||!/^[a-f0-9]{64}$/.test(input.bindingHash))throw new AwosError('AWOS_INPUT_INVALID',400);
  return locked(op,async()=>{
   const r=get(op,version);if(!r)throw new AwosError('AWOS_OPERATION_NOT_FOUND',404);
   if(r.version>1&&!r.parent_task_id)throw new AwosError('AWOS_LEGACY_VERSION_UNLINKED');
   if(version!==last(op))throw new AwosError('AWOS_VERSION_SUPERSEDED');
   const current=await client.call('view',r.task_id);
   if(followupStop(db,r.op_id,r.version))throw new AwosError('AWOS_BUSINESS_STOPPED');
   if(current.review?.bindingHash!==input.bindingHash||!samePayload(current.review.payload,r.payload))throw new AwosError('AWOS_REVIEW_CHANGED');
   if(current.effects.length)throw new AwosError('AWOS_EFFECT_EXISTS');
   if(r.decision_intent&&JSON.stringify(r.decision_intent)!==JSON.stringify(input)){
    if(r.decision_intent.bindingHash!==input.bindingHash||r.decision_intent.decision!==input.decision)throw new AwosError('AWOS_DECISION_CONFLICT');
   }
   else if(!r.decision_intent){db.run('UPDATE awos_ops SET decision_intent=?,stage=? WHERE op_id=? AND version=?',JSON.stringify(input),'decision-pending',op,version);hook('decision-pending',r);}
   return decideRow(get(op,version),input);
  });
 }
 return {contacts,prepare,resume,decide,list:async()=>{const rows=all(),views=[];for(const r of rows){try{views.push(await view(r));}catch(e){if(e.code!=='EMAIL_TASK_NOT_FOUND')throw e;views.push({opId:r.op_id,version:r.version,taskId:r.task_id,latest:r.version===last(r.op_id),stage:r.stage,request:r.request,desired:r.payload,state:'blocked',remote:null,error:e.code});}}return views;},get:async(op,version)=>{const r=get(op,version);if(!r)throw new AwosError('AWOS_OPERATION_NOT_FOUND',404);return view(r);}};
}
