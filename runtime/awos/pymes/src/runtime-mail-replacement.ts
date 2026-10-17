import {randomUUID} from 'node:crypto';
import type {TaskRuntimeKernel} from '@agent-world/task-runtime';
import type {JournalKernel} from '@agent-world/runtime-store-sqlite';
import {crmId,crmRecord,normalizeCrmEmail} from './crm-contract.js';
import {emailHash,type EmailPayload} from './email-provider.js';
import type {EmailReviewStore} from './email-review-store.js';
import type {CrmService} from './crm-service.js';
import {defineEmailLeadUnits} from './job-planner.js';

export interface RuntimeMailReplaceInput {
 requestId:string;bindingHash:string;replacementTaskId:string;
 to:string;subject:string;body:string;contactId:string;
}
export interface RuntimeMailReplacement {
 id:string;tenantId:string;owner:string;actor:string;taskId:string;
 replacementTaskId:string;rootTaskId:string;version:number;requestId:string;
 requestHash:string;bindingHash:string;payloadHash:string;at:number;
}
export interface RuntimeMailReplacementView {
 previousTaskId:string|null;replacementTaskId:string|null;
 rootTaskId:string;version:number;canReplace:boolean;
}
const isHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function parseRuntimeMailReplaceInput(value:unknown):RuntimeMailReplaceInput {
 const r=crmRecord(value);
 if(Object.keys(r).sort().join(',')!=='bindingHash,body,contactId,replacementTaskId,requestId,subject,to'||!isHash(r.bindingHash)||
  typeof r.subject!=='string'||!r.subject.trim()||r.subject.length>500||/[\r\n]/.test(r.subject)||
  typeof r.body!=='string'||!r.body.trim()||r.body.length>8000)throw Error('EMAIL_REPLACE_INPUT_INVALID');
 return {requestId:crmId(r.requestId),bindingHash:r.bindingHash,replacementTaskId:crmId(r.replacementTaskId),to:normalizeCrmEmail(r.to),subject:r.subject,body:r.body,contactId:crmId(r.contactId)};
}
/** Append-only journal projection. No effects, decisions or raw message bodies. */
export class RuntimeMailReplacementStore {
 private records:RuntimeMailReplacement[]=[];
 constructor(readonly tenantId:string){crmId(tenantId);}
 request(owner:string,requestId:string){return structuredClone(this.records.find(r=>r.owner===owner&&r.requestId===requestId)??null);}
 next(taskId:string,owner?:string){return structuredClone(this.records.find(r=>r.taskId===taskId&&(!owner||r.owner===owner))??null);}
 previous(taskId:string,owner?:string){return structuredClone(this.records.find(r=>r.replacementTaskId===taskId&&(!owner||r.owner===owner))??null);}
 record(input:RuntimeMailReplacement){
  const r=structuredClone(input);
  if(Object.keys(r).sort().join(',')!=='actor,at,bindingHash,id,owner,payloadHash,replacementTaskId,requestHash,requestId,rootTaskId,taskId,tenantId,version'||r.tenantId!==this.tenantId||r.owner!==r.actor||r.taskId===r.replacementTaskId||r.rootTaskId===r.replacementTaskId||!Number.isSafeInteger(r.version)||r.version<2||r.version>100||!Number.isSafeInteger(r.at)||r.at<0||![r.bindingHash,r.payloadHash,r.requestHash].every(isHash))throw Error('EMAIL_REPLACE_RECORD_INVALID');
  for(const v of [r.id,r.owner,r.taskId,r.replacementTaskId,r.rootTaskId,r.requestId])crmId(v);
  const old=this.request(r.owner,r.requestId);
  if(old){if(emailHash(old)!==emailHash(r))throw Error('EMAIL_REPLACE_REQUEST_CONFLICT');return old;}
  const previous=this.previous(r.taskId,r.owner);
  if(r.version!==(previous?.version??1)+1||r.rootTaskId!==(previous?.rootTaskId??r.taskId)||this.next(r.taskId)||this.previous(r.replacementTaskId)||this.next(r.replacementTaskId)||this.records.some(v=>v.id===r.id)||this.records.length>=50_000)throw Error('EMAIL_REPLACE_RECORD_CONFLICT');
  this.records.push(r);return structuredClone(r);
 }
 view(taskId:string,owner:string,canReplace:boolean):RuntimeMailReplacementView {
  const previous=this.previous(taskId,owner),next=this.next(taskId,owner);
  return {previousTaskId:previous?.taskId??null,replacementTaskId:next?.replacementTaskId??null,rootTaskId:previous?.rootTaskId??taskId,version:previous?.version??1,canReplace};
 }
}
export interface RuntimeMailReplacementHooks {beforePersist?:()=>void;afterParentCancelled?:()=>void;afterPersist?:()=>void;}
/** One transaction owns the link, cancellation, successor draft and CRM reuse. */
export class RuntimeMailReplacementService {
 constructor(readonly store:RuntimeMailReplacementStore,private journal:JournalKernel,private kernel:TaskRuntimeKernel,private reviews:EmailReviewStore,private crm:CrmService,private validate:(p:unknown)=>EmailPayload,private hooks:RuntimeMailReplacementHooks={}){}
 assertPayload(taskId:string,owner:string,payload:EmailPayload){
  const record=this.store.previous(taskId);if(!record)return;
  const parent=this.reviews.latest(record.taskId);
  const scope=(p:EmailPayload)=>({from:p.from,to:p.to,cc:p.cc,bcc:p.bcc,contactId:p.contactId,reply:p.reply??null});
  if(record.owner!==owner||!parent||parent.owner!==owner||emailHash(scope(parent.payload))!==emailHash(scope(payload)))throw Error('EMAIL_REPLACE_SCOPE_CHANGED');
 }
 replace(taskId:string,owner:string,input:RuntimeMailReplaceInput,guard:()=>void){
  if(!this.journal.isHealthy())throw Error('EMAIL_REPLACE_NOT_READY');
  const requestHash=emailHash({tenantId:this.store.tenantId,owner,taskId,...input}),old=this.store.request(owner,input.requestId);
  if(old){if(old.requestHash!==requestHash)throw Error('EMAIL_REPLACE_REQUEST_CONFLICT');return old;}
  guard();
  const review=this.reviews.latest(taskId),task=this.kernel.snapshot().tasks[taskId];
  if(!review||review.owner!==owner||!task||task.owner!==owner||review.bindingHash!==input.bindingHash)throw Error('EMAIL_REPLACE_REVIEW_CHANGED');
  if(review.payload.to.length!==1||review.payload.cc.length||review.payload.bcc.length||review.payload.reply||input.contactId!==review.payload.contactId||input.to!==review.payload.to[0])throw Error('EMAIL_REPLACE_SCOPE_CHANGED');
  const payload=this.validate({...review.payload,to:[input.to],subject:input.subject,body:input.body,contactId:input.contactId});
  const previous=this.store.previous(taskId,owner),version=(previous?.version??1)+1;
  if(version>100||this.kernel.snapshot().tasks[input.replacementTaskId])throw Error('EMAIL_REPLACE_TARGET_CONFLICT');
  const state=this.kernel.snapshot(),plan=state.plans.find(p=>p.taskId===taskId&&p.version===task.planVersion);
  const actual=plan?.workUnitIds.map(id=>{const {id:unitId,title,objective,dependencies,requiredCapabilities,constraints,expectedArtifacts,successCriteria}=state.workUnits[id]!;return {id:unitId,title,objective,dependencies,requiredCapabilities,constraints,expectedArtifacts,successCriteria};});
  if(emailHash(actual??null)!==emailHash(defineEmailLeadUnits({...task,planVersion:task.planVersion-1})))throw Error('EMAIL_REPLACE_PLAN_INVALID');
  this.crm.assertRuntimeReplacement(owner,taskId,payload);
  const at=Math.max(Date.now(),task.updatedAt),record:RuntimeMailReplacement={id:'runtime-replace-'+randomUUID(),tenantId:this.store.tenantId,owner,actor:owner,taskId,replacementTaskId:input.replacementTaskId,rootTaskId:previous?.rootTaskId??taskId,version,requestId:input.requestId,requestHash,bindingHash:review.bindingHash,payloadHash:emailHash(payload),at};
  this.hooks.beforePersist?.();
  this.journal.transaction(()=>{
   guard();this.crm.assertRuntimeReplacement(owner,taskId,payload);
   this.store.record(record);
   const apply=(id:string,event:Record<string,unknown>)=>this.kernel.apply({id:randomUUID(),taskId:id,at,...event} as Parameters<TaskRuntimeKernel['apply']>[0],this.kernel.snapshot().revision);
   apply(taskId,{type:'DecisionRecorded',referenceId:record.id});
   apply(taskId,{type:'EvidenceRecorded',referenceId:record.id+':evidence'});
   apply(taskId,{type:'GlobalTaskCancelled'});
   this.hooks.afterParentCancelled?.();
   const id=input.replacementTaskId;
   apply(id,{type:'GlobalTaskCreated',goal:task.goal,owner,successCriteria:task.successCriteria});
   apply(id,{type:'GlobalTaskPlanningStarted'});
   apply(id,{type:'PlanCommitted',planVersion:1,workUnits:defineEmailLeadUnits({id,owner,planVersion:0})});
   this.reviews.saveDraft({taskId:id,owner,payload,at});
   this.crm.prepareRuntimeReplacement(owner,taskId,id,payload,task.goal);
   this.reviews.audit({id:record.id,taskId,at,type:'runtime.draft.superseded',reference:id});
   this.reviews.audit({id:record.id+':successor',taskId:id,at,type:'runtime.draft.replaces',reference:taskId});
  });
  this.hooks.afterPersist?.();return record;
 }
}
