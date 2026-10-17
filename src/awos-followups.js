import {createHash,randomUUID} from 'node:crypto';
import {AwosError} from './awos-client.js';
import {renderFollowup} from './proposal-templates.js';

const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const derivedUuid=value=>{const h=createHash('sha256').update(value).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export const followupOperationIds=id=>({opId:derivedUuid(`followup-op:${id}`),commandId:derivedUuid(`followup-command:${id}`)});
const parse=r=>r&&({...r,version:Number(r.version)});
export function addBusinessDays(from,days=3){const d=new Date(from);let left=days;while(left){d.setUTCDate(d.getUTCDate()+1);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)left--;}return d.toISOString();}

// Orchestration barrier only; never changes an AWOS task, approval or effect.
export function followupStop(db,opId,version){
 if(!db.all("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_followup_stops'").length)return null;
 const seen=new Set();let op=opId,v=version;
 for(let n=0;n<100;n++){
  if(seen.has(op))throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');seen.add(op);
  const stop=db.all("SELECT * FROM awos_followup_stops WHERE op_id=? AND (kind='close' OR version>=?) ORDER BY id DESC LIMIT 1",op,v)[0];if(stop)return {kind:stop.kind,commandId:stop.command_id,reason:stop.reason};
  const hasOps=db.all("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_ops'").length,row=hasOps?db.all('SELECT * FROM awos_ops WHERE op_id=? ORDER BY version LIMIT 1',op)[0]:null;
  const f=row?.followup_id?db.all('SELECT * FROM awos_followups WHERE id=?',row.followup_id)[0]:db.all('SELECT * FROM awos_followups WHERE followup_op_id=?',op)[0];if(!f)return null;op=f.op_id;v=f.version;
 }throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');
}
export function createAwosFollowups(db,flow,{clock=()=>new Date()}={}){
 db.run(`CREATE TABLE IF NOT EXISTS awos_followups (id TEXT PRIMARY KEY, op_id TEXT NOT NULL, version INTEGER NOT NULL, task_id TEXT NOT NULL, due_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('scheduled','due','drafted','dismissed','superseded')), followup_op_id TEXT, note TEXT NOT NULL DEFAULT '', dismiss_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE)`);
 const columns=new Set(db.all('PRAGMA table_info(awos_followups)').map(c=>c.name));if(!columns.has('stop_command_id'))db.run('ALTER TABLE awos_followups ADD COLUMN stop_command_id TEXT');
 const preparing=new Set();
 const get=id=>parse(db.all('SELECT * FROM awos_followups WHERE id=?',id)[0]);
 const list=()=>db.all('SELECT * FROM awos_followups ORDER BY due_at,id').map(parse);
 async function source(row){return flow.get(row.op_id,row.version);}
 async function schedule(input){
  if(!uuid(input?.commandId)||!uuid(input?.opId)||!Number.isSafeInteger(input.version)||input.version<1||input.dueAt!==undefined&&!iso(input.dueAt)||typeof (input.note??'')!=='string'||(input.note??'').length>1000)throw new AwosError('AWOS_FOLLOWUP_INPUT_INVALID',400);
  const prior=db.all('SELECT * FROM awos_followups WHERE command_id=?',input.commandId)[0];if(prior){if(prior.op_id!==input.opId||Number(prior.version)!==input.version||prior.due_at!==(input.dueAt??prior.due_at)||prior.note!==(input.note??''))throw new AwosError('AWOS_COMMAND_CONFLICT');return parse(prior);}
  if(followupStop(db,input.opId,input.version))throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');
  const op=await flow.get(input.opId,input.version);if(!op.template||!op.latest||op.state!=='ready'||op.remote?.effects?.length)throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');
  if(followupStop(db,input.opId,input.version))throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');
  const at=clock().toISOString(),due=input.dueAt??addBusinessDays(at),id=input.id??randomUUID();if(!uuid(id)||!iso(due)||Date.parse(due)<=Date.parse(at))throw new AwosError('AWOS_FOLLOWUP_INPUT_INVALID',400);
  db.run('INSERT INTO awos_followups (id,op_id,version,task_id,due_at,state,note,created_at,updated_at,command_id) VALUES (?,?,?,?,?,?,?,?,?,?)',id,input.opId,input.version,op.taskId,due,'scheduled',input.note??'',at,at,input.commandId);return get(id);
 }
 async function tick(){
  const at=clock().toISOString(),candidates=db.all("SELECT * FROM awos_followups WHERE state='scheduled' AND due_at<=? ORDER BY due_at,id",at);let changed=0;
  for(const raw of candidates){const row=parse(raw);if(followupStop(db,row.op_id,row.version))continue;let op;try{op=await source(row);}catch{continue;}if(!op.latest){db.run("UPDATE awos_followups SET state='superseded',updated_at=? WHERE id=? AND state='scheduled'",at,row.id);continue;}if(op.state!=='ready'||op.remote?.effects?.length)continue;changed+=db.run("UPDATE awos_followups SET state='due',updated_at=? WHERE id=? AND state='scheduled'",at,row.id).changes;}
  return changed;
 }
 async function prepare(id){
  if(preparing.has(id))throw new AwosError('AWOS_FOLLOWUP_BUSY');preparing.add(id);try{
  const row=get(id);if(!row)throw new AwosError('AWOS_FOLLOWUP_NOT_FOUND',404);if(!['due','drafted'].includes(row.state))throw new AwosError('AWOS_FOLLOWUP_NOT_DUE');
  if(followupStop(db,row.op_id,row.version))throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');
  const op=await source(row);if(!op.latest||op.state!=='ready'||op.remote?.effects?.length)throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');
  const ids=followupOperationIds(row.id),context=op.template?.variables??{},followupOpId=row.followup_op_id??ids.opId,commandId=ids.commandId,rendered=renderFollowup({cliente:context.cliente??op.desired.to,servicio:context.servicio??op.desired.subject,nota:row.note});
  const hasOps=db.all("SELECT 1 FROM sqlite_master WHERE type='table' AND name='awos_ops'").length,existing=hasOps?db.all('SELECT * FROM awos_ops WHERE op_id=? AND version=1',followupOpId)[0]:null,legacy=existing&&!existing.followup_id;
  const draft=legacy&&flow.resume?await flow.resume(followupOpId,1):await flow.prepare({...(legacy?{}:{followupId:row.id}),...(op.intakeCommandId?{intakeCommandId:op.intakeCommandId}:{}),opId:followupOpId,commandId,expectedVersion:0,contactId:op.desired.contactId,request:`Seguimiento de la propuesta ${op.taskId}. ${row.note}`.trim(),subject:rendered.subject,body:rendered.body});
  db.run("UPDATE awos_followups SET state=CASE WHEN state='due' THEN 'drafted' ELSE state END,followup_op_id=?,updated_at=? WHERE id=? AND state IN ('due','drafted','superseded','dismissed')",followupOpId,clock().toISOString(),id);const current=get(id);if(current.state!=='drafted')throw new AwosError('AWOS_FOLLOWUP_SOURCE_BLOCKED');return {followup:current,operation:draft};
  }finally{preparing.delete(id);}
 }
 function dismiss(id,reason){if(preparing.has(id))throw new AwosError('AWOS_FOLLOWUP_BUSY');if(typeof reason!=='string'||!reason.trim()||reason.length>500)throw new AwosError('AWOS_FOLLOWUP_INPUT_INVALID',400);const at=clock().toISOString(),n=db.run("UPDATE awos_followups SET state='dismissed',dismiss_reason=?,updated_at=? WHERE id=? AND state IN ('scheduled','due')",reason.trim(),at,id).changes;if(!n)throw new AwosError('AWOS_FOLLOWUP_NOT_ACTIONABLE');return get(id);}
 function supersede(opId,version){return db.run("UPDATE awos_followups SET state='superseded',updated_at=? WHERE op_id=? AND version=? AND state IN ('scheduled','due')",clock().toISOString(),opId,version).changes;}
 function stopPending(opIds,reason,commandId){let total=0;for(const op of opIds)total+=db.run("UPDATE awos_followups SET state='dismissed',dismiss_reason=?,stop_command_id=?,updated_at=? WHERE op_id=? AND state IN ('scheduled','due')",reason,commandId,clock().toISOString(),op).changes;return total;}
 return {schedule,tick,prepare,dismiss,supersede,stopPending,get,list,defaultDue:()=>addBusinessDays(clock().toISOString())};
}

export function createFollowupScheduler(followups,{intervalMs=60_000}={}){let timer;const run=()=>followups.tick().catch(()=>{});return {start(){if(timer)return;run();timer=setInterval(run,intervalMs);timer.unref?.();},stop(){if(timer)clearInterval(timer);timer=undefined;},run};}
