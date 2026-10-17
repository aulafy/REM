// Child verifier only: no server, planning, approval, connector or effect execution.
// Runs with the AWOS checkout's existing tsx loader, in a private copied directory.
import {DatabaseSync} from 'node:sqlite';import {deserialize} from 'node:v8';
import {pathToFileURL} from 'node:url';import {join} from 'node:path';import {createHash} from 'node:crypto';
const [root,repo]=process.argv.slice(2);if(!root||!repo)throw Error('COPY_VERIFY_ARGUMENTS');
const {openWorkspaceRuntime}=await import(pathToFileURL(join(repo,'pymes/src/runtime-source.ts')).href);
const {emailHash}=await import(pathToFileURL(join(repo,'pymes/src/email-provider.ts')).href);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const local=new DatabaseSync(join(root,'data/pyme1.db'),{readOnly:true}),journal=new DatabaseSync(join(root,'runtime/runtime.db'),{readOnly:true});
let runtime;
try{
 const tenant=journal.prepare("SELECT args FROM store_commands WHERE store_name='pymesTenantBinding' AND method_name='bind' ORDER BY sequence").all();
 if(tenant.length!==1||deserialize(tenant[0].args)[0]!=='pyme1-local')throw Error('COPY_TENANT_MISMATCH');
 const claims=journal.prepare("SELECT args FROM store_commands WHERE store_name='effects' AND method_name='create' ORDER BY sequence").all().map(r=>deserialize(r.args)[0]);
 const crmCommands=journal.prepare("SELECT args FROM store_commands WHERE store_name='pymesCrm' AND method_name='apply' ORDER BY sequence").all().map(r=>deserialize(r.args)[0]);
 journal.close();
 const columns=new Set(local.prepare('PRAGMA table_info(awos_ops)').all().map(c=>c.name));
 if(!['op_id','version','command_id','identity_hash','task_id','payload','stage','decision_intent'].every(k=>columns.has(k)))throw Error('COPY_ORCHESTRATION_MISSING');
 const rows=local.prepare('SELECT * FROM awos_ops ORDER BY op_id,version').all();
 const hasFollowups=local.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_followups'").get();
 const followups=hasFollowups?local.prepare('SELECT * FROM awos_followups ORDER BY id').all():[];
 const hasTemplates=local.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_op_templates'").get();
 const templateRows=new Map(hasTemplates?local.prepare('SELECT * FROM awos_op_templates').all().map(t=>[t.op_id+'#'+t.version,{templateId:t.template_id,templateVersion:t.template_version,variables:JSON.parse(t.variables)}]):[]);if(rows.length>20_000)throw Error('COPY_SIZE_LIMIT');
 runtime=await openWorkspaceRuntime(join(root,'runtime/runtime.db'),'pyme1-local',{fakeEmail:true});
 const state=runtime.kernel.snapshot(),byTask=new Map(rows.map(r=>[r.task_id,r]));if(byTask.size!==rows.length)throw Error('COPY_DUPLICATE_TASK');
 const intakes=local.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_intakes'").get()?local.prepare('SELECT * FROM awos_intakes ORDER BY created_at,command_id').all():[];
 const counts={intakes:intakes.length,operations:rows.length,followups:followups.length,pending:0,legacyUnlinked:0,reviews:0,decisions:0,cancelled:0,unknown:0,effects:0};
 const groups=new Map();
 for(const r of rows){
  const p=JSON.parse(r.payload),intent=r.decision_intent?JSON.parse(r.decision_intent):null;
  if(!uuid.test(r.op_id)||!uuid.test(r.command_id)||!Number.isSafeInteger(r.version)||r.version<1||r.version>100||r.task_id!==`p1-${r.op_id}-v${r.version}`||!['recorded','created','planned','draft','reviewed','decision-pending','decided','replaced'].includes(r.stage)||typeof r.created_at!=='string'||!Number.isFinite(Date.parse(r.created_at))||typeof r.request!=='string'||r.request.length>8000||!p||Object.keys(p).sort().join(',')!=='body,contactId,subject,to'||typeof p.body!=='string'||!p.body.trim()||p.body.length>6000||typeof p.subject!=='string'||!p.subject.trim()||p.subject.length>200||/[\r\n]/.test(p.subject)||typeof p.contactId!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(p.contactId)||!String(p.to).endsWith('@example.test')||r.contact_id!==p.contactId)throw Error('COPY_OPERATION_INVALID');
  const tpl=templateRows.get(r.op_id+'#'+r.version);if(r.identity_hash!==hash({opId:r.op_id,expectedVersion:r.version-1,request:r.request,payload:p,...(tpl?{template:tpl}:{}),...(r.intake_command_id?{intakeCommandId:r.intake_command_id}:{}),...(r.followup_id?{followupId:r.followup_id}:{})}))throw Error('COPY_COMMAND_IDENTITY_MISMATCH');
  const versions=groups.get(r.op_id)??[];if(r.version!==versions.length+1)throw Error('COPY_VERSION_GAP');versions.push(r);groups.set(r.op_id,versions);
  if(r.version===1&&(r.parent_task_id||r.parent_binding_hash))throw Error('COPY_PARENT_INVALID');
  const parent=r.version>1?byTask.get(`p1-${r.op_id}-v${r.version-1}`):null;
  if(r.parent_task_id&&(r.parent_task_id!==parent?.task_id||typeof r.parent_binding_hash!=='string'||!/^[a-f0-9]{64}$/.test(r.parent_binding_hash)||!parent))throw Error('COPY_PARENT_INVALID');
  if(r.version>1&&!r.parent_task_id)counts.legacyUnlinked++;
  const contact=runtime.source.crm.view('pyme1-local','pyme1-owner','',p.contactId,'all');
  if(contact.identities.filter(i=>i.active&&i.contactId===p.contactId&&i.email===p.to).length!==1)throw Error('COPY_CONTACT_MISMATCH');
  const task=state.tasks[r.task_id];if(!task){if(r.stage!=='recorded'||intent)throw Error('COPY_MISSING_TASK');counts.pending++;continue;}
  if(task.owner!=='pyme1-owner')throw Error('COPY_OWNER_MISMATCH');
  const view=runtime.source.email.view(r.task_id,'pyme1-owner');
  if(view.source)throw Error('COPY_GMAIL_SOURCE_FORBIDDEN');
  const payload=view.review?.payload??view.draft;
  if(payload&&(payload.from!=='office@example.test'||JSON.stringify(payload.to)!==JSON.stringify([p.to])||payload.cc.length||payload.bcc.length||payload.reply||payload.subject!==p.subject||payload.body!==p.body||payload.contactId!==p.contactId))throw Error('COPY_PAYLOAD_MISMATCH');
  if(['reviewed','decision-pending','decided'].includes(r.stage)&&!view.review)throw Error('COPY_REVIEW_MISSING');
  if(intent&&(!view.review||Object.keys(intent).sort().join(',')!=='bindingHash,commandId,decision'||!uuid.test(intent.commandId)||intent.bindingHash!==view.review.bindingHash||!['approved','rejected'].includes(intent.decision)))throw Error('COPY_INTENT_INVALID');
  if(view.decision&&(!intent||view.decision.decision!==intent.decision||view.decision.bindingHash!==intent.bindingHash||view.decision.userId!=='pyme1-owner'))throw Error('COPY_DECISION_MISMATCH');
  if(r.stage==='decided'&&!view.decision)throw Error('COPY_DECISION_MISSING');
  if(r.parent_task_id){
   const v=runtime.source.email.view(r.parent_task_id,'pyme1-owner');
   if(v.status!=='cancelled'||v.runtimeReplacement?.replacementTaskId!==r.task_id||v.review?.bindingHash!==r.parent_binding_hash||view.runtimeReplacement?.previousTaskId!==r.parent_task_id||view.runtimeReplacement?.version!==r.version)throw Error('COPY_REPLACEMENT_MISMATCH');
  }
  if(view.review)counts.reviews++;if(view.decision)counts.decisions++;if(view.status==='cancelled')counts.cancelled++;if(view.status==='unknown')counts.unknown++;counts.effects+=view.effects.length;
 }
 for(const id of Object.keys(state.tasks))if(!byTask.has(id))throw Error('COPY_ORPHAN_RUNTIME_TASK');
 for(const r of rows)if(r.intake_command_id){const intake=intakes.find(i=>i.command_id===r.intake_command_id);if(!intake||intake.stage!=='linked'||intake.contact_id!==r.contact_id)throw Error('COPY_INTAKE_PROPOSAL_SCOPE');}
 const pasteReceipts=intakes.length||local.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_intake_messages'").get()?local.prepare('SELECT * FROM awos_intake_messages').all():[];
 for(const p of pasteReceipts){const m=local.prepare('SELECT text,sender,channel FROM inbox WHERE id=?').get(p.message_id);if(!uuid.test(p.command_id)||!m||hash(m)!==p.identity_hash)throw Error('COPY_INTAKE_MESSAGE_INVALID');}
 const intakeIds=new Set();
 for(const r of intakes){
  const frozen=JSON.parse(r.input),d=frozen.data,source=local.prepare('SELECT id,channel,sender,text,created_at FROM inbox WHERE id=?').get(r.message_id);
  if(!uuid.test(r.command_id)||intakeIds.has(r.command_id)||!source||hash(source)!==r.source_hash||!d||typeof frozen.previewHash!=='string'||!/^[a-f0-9]{64}$/.test(frozen.previewHash)||d.messageId!==r.message_id||typeof d.name!=='string'||typeof d.email!=='string'||typeof d.phone!=='string'||!['recorded','linked','blocked'].includes(r.stage)||!/^[-a-zA-Z0-9_]{1,200}$/.test(r.contact_id)||!Number.isFinite(Date.parse(r.created_at))||!Number.isFinite(Date.parse(r.updated_at))||r.identity_hash!==hash({commandId:r.command_id,...d,previewHash:frozen.previewHash,contactId:frozen.selectedContactId,confirmed:true}))throw Error('COPY_INTAKE_INVALID');
  const command=r.crm_command?JSON.parse(r.crm_command):null,recorded=command&&crmCommands.some(c=>c.tenant==='pyme1-local'&&c.owner==='pyme1-owner'&&c.commandId===command.commandId&&JSON.stringify(c.operation)===JSON.stringify(command.operation));
  if(command&&(command.operation.type!=='contact.create'||command.operation.id!==r.contact_id||command.commandId!=='p1-capture-'+r.command_id)||r.stage==='blocked'&&recorded)throw Error('COPY_INTAKE_COMMAND_INVALID');
  if(r.stage==='linked'){const detail=runtime.source.crm.view('pyme1-local','pyme1-owner','',r.contact_id,'all');if(!detail.contacts.some(c=>c.id===r.contact_id)||command&&!recorded)throw Error('COPY_INTAKE_CONTACT_INVALID');}
  const last=local.prepare('SELECT stage,error FROM awos_intake_events WHERE command_id=? ORDER BY id DESC LIMIT 1').get(r.command_id);if(!last||last.stage!==r.stage||last.error!==r.error)throw Error('COPY_INTAKE_EVENT_INVALID');
  intakeIds.add(r.command_id);
 }
 for(const r of rows)if(r.followup_id){const f=followups.find(f=>f.id===r.followup_id);if(!f)throw Error('COPY_FOLLOWUP_ORIGIN_INVALID');const child=runtime.source.crm.store.workflow('pyme1-owner',r.task_id),parent=runtime.source.crm.store.workflow('pyme1-owner',f.task_id);if(state.tasks[r.task_id]&&runtime.source.email.view(r.task_id,'pyme1-owner').review&&(!child||!parent||child.leadId!==parent.leadId||child.contactId!==parent.contactId))throw Error('COPY_FOLLOWUP_LEAD_INVALID');}
 const business=local.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_business'").get()?local.prepare('SELECT * FROM awos_business').all():[];
 const stops=local.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_followup_stops'").get()?local.prepare('SELECT * FROM awos_followup_stops').all():[];
 for(const r of business){
  const i=JSON.parse(r.input),cmd=JSON.parse(r.crm_command),op=rows.find(o=>o.op_id===r.op_id&&o.version===r.version),w=runtime.source.crm.store.workflow('pyme1-owner',r.task_id);
  if(!uuid.test(r.command_id)||!op||op.task_id!==r.task_id||op.contact_id!==r.contact_id||!w||w.leadId!==r.lead_id||w.contactId!==r.contact_id||hash(i)!==r.identity_hash||i.commandId!==r.command_id||i.opId!==r.op_id||i.version!==r.version||i.leadId!==r.lead_id||!['reply','close'].includes(i.kind)||i.confirmed!==true||typeof i.reason!=='string'||i.reason.length>500||!['recorded','committed','blocked'].includes(r.stage))throw Error('COPY_BUSINESS_INVALID');
  const review=runtime.source.email.view(r.task_id,'pyme1-owner').review;if(review?.bindingHash!==i.bindingHash)throw Error('COPY_BUSINESS_REVIEW_INVALID');
  if(i.kind==='reply'){const m=local.prepare('SELECT id,channel,sender,text,created_at FROM inbox WHERE id=?').get(i.messageId);if(!m||hash(m)!==r.source_hash||cmd.operation.type!=='interaction.note'||cmd.operation.id!=='p1-response-'+r.command_id||cmd.operation.contactId!==r.contact_id||cmd.operation.summary!==`Respuesta pegada manualmente a ${r.task_id}:\n${m.text.slice(0,1700)}`)throw Error('COPY_BUSINESS_SOURCE_INVALID');}
  else if(r.source_hash!==null||!['won','lost'].includes(i.status)||!i.reason.trim()||cmd.operation.type!=='lead.update'||cmd.operation.id!==r.lead_id||cmd.operation.status!==i.status)throw Error('COPY_BUSINESS_CLOSURE_INVALID');
  if(cmd.commandId!=='p1-business-'+r.command_id||r.stage==='committed'&&!crmCommands.some(c=>c.tenant==='pyme1-local'&&c.owner==='pyme1-owner'&&c.commandId===cmd.commandId&&JSON.stringify(c.operation)===JSON.stringify(cmd.operation)))throw Error('COPY_BUSINESS_JOURNAL_INVALID');
  const last=local.prepare('SELECT stage,error FROM awos_business_events WHERE command_id=? ORDER BY id DESC LIMIT 1').get(r.command_id);if(!last||last.stage!==r.stage||last.error!==r.error||!stops.some(s=>s.command_id===r.command_id&&s.op_id===r.op_id))throw Error('COPY_BUSINESS_HISTORY_INVALID');
 }
 for(const s of stops){const r=business.find(r=>r.command_id===s.command_id),o=rows.find(r=>r.op_id===s.op_id&&r.version===s.version);if(!r||!o||s.kind!==JSON.parse(r.input).kind||!s.reason)throw Error('COPY_BUSINESS_STOP_INVALID');}
 for(const f of followups)if(f.stop_command_id&&(!business.some(r=>r.command_id===f.stop_command_id)||f.state!=='dismissed'||!stops.some(s=>s.command_id===f.stop_command_id&&s.op_id===f.op_id)))throw Error('COPY_FOLLOWUP_STOP_INVALID');
 counts.businessRecords=business.length;counts.businessStops=stops.length;
 const followupIds=new Set(),followupCommands=new Set();
 for(const f of followups){
  const source=rows.find(r=>r.op_id===f.op_id&&r.version===f.version);if(!source||source.task_id!==f.task_id)throw Error('COPY_FOLLOWUP_SOURCE_INVALID');
  if(!uuid.test(f.id)||!uuid.test(f.command_id)||followupIds.has(f.id)||followupCommands.has(f.command_id)||!['scheduled','due','drafted','dismissed','superseded'].includes(f.state)||!Number.isFinite(Date.parse(f.due_at))||!Number.isFinite(Date.parse(f.created_at))||!Number.isFinite(Date.parse(f.updated_at))||typeof f.note!=='string'||f.note.length>1000)throw Error('COPY_FOLLOWUP_INVALID');
  if(f.followup_op_id!==null&&(!uuid.test(f.followup_op_id)||!rows.some(r=>r.op_id===f.followup_op_id))||f.state==='drafted'&&!f.followup_op_id)throw Error('COPY_FOLLOWUP_LINK_INVALID');
  followupIds.add(f.id);followupCommands.add(f.command_id);
 }
 // Check every successor link too, including a local command recorded just before
 // a lost replacement response. Missing runtime work may be resumable; missing
 // local intent for an already published successor is never silently recreated.
 for(const r of rows){if(!state.tasks[r.task_id])continue;const v=runtime.source.email.view(r.task_id,'pyme1-owner'),next=v.runtimeReplacement?.replacementTaskId;if(next&&(!state.tasks[next]||byTask.get(next)?.parent_task_id!==r.task_id))throw Error('COPY_ORPHAN_REPLACEMENT');}
 const fake=new DatabaseSync(join(root,'runtime/runtime.db.fake-email.db'),{readOnly:true});let calls,receipts;
 try{
  const sent=fake.prepare('SELECT key,payload_hash,payload FROM receipts').all(),attempted=fake.prepare('SELECT key FROM calls').all();calls=attempted.length;receipts=sent.length;
  const sentByKey=new Map(sent.map(r=>[r.key,r])),claimByKey=new Map(claims.map(r=>[r.idempotencyKey,r]));
  for(const r of sent){const claim=claimByKey.get(r.key),review=claim?runtime.source.email.view(claim.taskId,'pyme1-owner').review:null;if(!claim||claim.action!=='email.send'||!review||r.payload_hash!==review.payloadHash||emailHash(JSON.parse(r.payload))!==review.payloadHash||!attempted.some(c=>c.key===r.key))throw Error('COPY_FAKE_RECEIPT_MISMATCH');}
  for(const c of attempted)if(!sentByKey.has(c.key))throw Error('COPY_FAKE_CALL_MISMATCH');
  for(const claim of claims){const v=runtime.source.email.view(claim.taskId,'pyme1-owner'),effect=v.effects.find(e=>e.id===claim.id);if(!effect||effect.effective==='committed'&&!sentByKey.has(claim.idempotencyKey))throw Error('COPY_COMMITTED_RECEIPT_MISSING');}
 }finally{fake.close();}
 const crm=runtime.source.crm.view('pyme1-local','pyme1-owner','',null,'all');
 console.log(JSON.stringify({format:'pyme1-awos-verified-v1',...counts,fakeCalls:calls,fakeReceipts:receipts,crmLeads:crm.counts.leads,journalRevision:state.revision}));
}catch{process.exitCode=1;}finally{local.close();try{journal.close();}catch{}runtime?.close();}
