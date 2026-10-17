// Local orchestration receipts only. Contact records and mutations belong to AWOS.
import {createHash} from 'node:crypto';import {AwosError} from './awos-client.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.split(',').sort().join(',');
const text=(v,max,empty=false)=>{if(typeof v!=='string'||v.length>max||!empty&&!v.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);return v.trim();};
export function intakePhone(v){const p=text(v,100,true);if(!p)return '';if(!/^\+?[\d ()-]+$/.test(p))throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);let digits=p.replace(/\D/g,'');if(digits.startsWith('0034')&&digits.length===13)digits=digits.slice(4);else if(digits.startsWith('34')&&digits.length===11)digits=digits.slice(2);if(digits.length<9||digits.length>15)throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);return digits;}
export function createAwosIntakes(db,client,{hook=()=>{},clock=()=>new Date()}={}){
 db.run('CREATE TABLE IF NOT EXISTS awos_intakes (command_id TEXT PRIMARY KEY,message_id INTEGER NOT NULL,input TEXT NOT NULL,identity_hash TEXT NOT NULL,source_hash TEXT NOT NULL,crm_command TEXT,contact_id TEXT NOT NULL,stage TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)');
 db.run('CREATE TABLE IF NOT EXISTS awos_intake_messages (command_id TEXT PRIMARY KEY,identity_hash TEXT NOT NULL,message_id INTEGER NOT NULL)');
 db.run('CREATE TABLE IF NOT EXISTS awos_intake_events (id INTEGER PRIMARY KEY,command_id TEXT NOT NULL,stage TEXT NOT NULL,at TEXT NOT NULL,error TEXT)');
 const busy=new Set(),get=id=>db.all('SELECT * FROM awos_intakes WHERE command_id=?',id)[0];
 const source=id=>{if(!Number.isSafeInteger(id)||id<1)throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);const m=db.all('SELECT id,channel,sender,text,created_at FROM inbox WHERE id=?',id)[0];if(!m)throw new AwosError('AWOS_INTAKE_MESSAGE_NOT_FOUND',404);return m;};
 const input=v=>{if(!keys(v,'messageId,name,email,phone'))throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);source(v.messageId);const name=text(v.name,200),email=text(v.email,254,true).toLowerCase(),phone=text(v.phone,100,true);intakePhone(phone);if(email&&!/^[^\s<>@,;]+@example\.test$/.test(email)||!email&&!phone)throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);return {messageId:v.messageId,name,email,phone};};
 const publicRow=r=>r&&({commandId:r.command_id,messageId:r.message_id,input:JSON.parse(r.input),contactId:r.contact_id,stage:r.stage,error:r.error,createdAt:r.created_at,updatedAt:r.updated_at});
 function mark(id,stage,error=null){const at=clock().toISOString();db.run('BEGIN IMMEDIATE');try{db.run('UPDATE awos_intakes SET stage=?,error=?,updated_at=? WHERE command_id=?',stage,error,at,id);db.run('INSERT INTO awos_intake_events(command_id,stage,at,error) VALUES (?,?,?,?)',id,stage,at,error);db.run('COMMIT');}catch(e){db.run('ROLLBACK');throw e;}hook(stage,get(id));}
 async function locked(id,fn){if(busy.has(id))throw new AwosError('AWOS_INTAKE_BUSY');busy.add(id);try{return await fn();}finally{busy.delete(id);}}
 async function snapshot(){
  const view=await client.call('crm');if(!Number.isSafeInteger(view.revision)||view.revision<0||!Array.isArray(view.contacts)||view.contactsTruncated!==false||view.contacts.length>200||view.totalContacts!==view.contacts.length)throw new AwosError('AWOS_INTAKE_INCOMPLETE_CRM');
  const contacts=[];for(const c of view.contacts){const d=await client.call('crm',c.id);if(d.revision!==view.revision||!Array.isArray(d.identities)||d.identities.length>=100)throw new AwosError('AWOS_INTAKE_CRM_CHANGED');contacts.push({...c,emails:d.identities.filter(i=>i.active&&i.contactId===c.id).map(i=>i.email)});}
  const end=await client.call('crm');if(end.revision!==view.revision)throw new AwosError('AWOS_INTAKE_CRM_CHANGED');return {revision:view.revision,contacts};
 }
 async function preview(raw){const data=input(raw),message=source(data.messageId),crm=await snapshot(),phone=intakePhone(data.phone);
  const matches=crm.contacts.filter(c=>data.email&&c.emails.includes(data.email)||phone&&intakePhone(c.phone)===phone).map(c=>({id:c.id,name:c.name,phone:c.phone,emails:c.emails,status:c.status,version:c.version}));
  return {...data,revision:crm.revision,matches,previewHash:hash({data,source:hash(message),revision:crm.revision,matches}),canCreate:matches.length===0};
 }
 async function resumeRow(r){
  if(hash(source(r.message_id))!==r.source_hash)throw new AwosError('AWOS_INTAKE_SOURCE_CHANGED');
  if(r.stage==='blocked')throw new AwosError('AWOS_INTAKE_REVIEW_REQUIRED');
  if(r.stage==='linked')return publicRow(r);
  if(r.crm_command){try{const result=await client.call('crmCommand',null,JSON.parse(r.crm_command));if(result.result.contactId!==r.contact_id)throw new AwosError('AWOS_RESPONSE_INVALID',502);}catch(e){if(e.code==='CRM_REVISION_CONFLICT'){mark(r.command_id,'blocked','CRM_REVISION_CONFLICT');throw new AwosError('AWOS_INTAKE_REVIEW_REQUIRED');}throw e;}hook('crm-response',r);}
  const view=await client.call('crm',r.contact_id);if(!view.contacts?.some(c=>c.id===r.contact_id))throw new AwosError('AWOS_INTAKE_CONTACT_NOT_FOUND');
  mark(r.command_id,'linked');return publicRow(get(r.command_id));
 }
 async function capture(raw){
  if(!keys(raw,'commandId,messageId,name,email,phone,previewHash,contactId,confirmed')||!uuid(raw.commandId)||raw.confirmed!==true||typeof raw.previewHash!=='string'||!/^[a-f0-9]{64}$/.test(raw.previewHash)||raw.contactId!==null&&typeof raw.contactId!=='string')throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);
  const data=input({messageId:raw.messageId,name:raw.name,email:raw.email,phone:raw.phone}),identity=hash({commandId:raw.commandId,...data,previewHash:raw.previewHash,contactId:raw.contactId,confirmed:true});
  return locked(data.messageId,async()=>{
   const old=get(raw.commandId);if(old){if(old.identity_hash!==identity)throw new AwosError('AWOS_COMMAND_CONFLICT');return resumeRow(old);}
   const prior=db.all("SELECT * FROM awos_intakes WHERE message_id=? AND stage IN ('recorded','linked') ORDER BY created_at DESC LIMIT 1",data.messageId)[0];if(prior){if(hash(JSON.parse(prior.input).data)!==hash(data)||raw.contactId!==null&&raw.contactId!==prior.contact_id)throw new AwosError('AWOS_INTAKE_ALREADY_LINKED');return resumeRow(prior);}
   const checked=await preview(data);if(checked.previewHash!==raw.previewHash)throw new AwosError('AWOS_INTAKE_CRM_CHANGED');
   let contactId,command=null;
   if(checked.matches.length){const chosen=checked.matches.find(c=>c.id===raw.contactId);if(!chosen||chosen.status!=='active')throw new AwosError('AWOS_INTAKE_MATCH_REVIEW');contactId=chosen.id;}
   else{if(raw.contactId!==null)throw new AwosError('AWOS_INTAKE_MATCH_REVIEW');contactId='p1-contact-'+hash(data.email?['email',data.email]:['phone',intakePhone(data.phone)]);command={commandId:'p1-capture-'+raw.commandId,expectedRevision:checked.revision,operation:{type:'contact.create',id:contactId,name:data.name,email:data.email,phone:data.phone,notes:'Contacto creado desde una solicitud pegada manualmente en REM. No acredita recepción por un conector.',relationship:'prospect'}};}
   const at=clock().toISOString(),frozen={data,previewHash:raw.previewHash,selectedContactId:raw.contactId};
   db.run('BEGIN IMMEDIATE');try{db.run('INSERT INTO awos_intakes(command_id,message_id,input,identity_hash,source_hash,crm_command,contact_id,stage,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',raw.commandId,data.messageId,JSON.stringify(frozen),identity,hash(source(data.messageId)),command?JSON.stringify(command):null,contactId,'recorded',null,at,at);db.run('INSERT INTO awos_intake_events(command_id,stage,at,error) VALUES (?,?,?,NULL)',raw.commandId,'recorded',at);db.run('COMMIT');}catch(e){db.run('ROLLBACK');throw e;}hook('recorded',get(raw.commandId));return resumeRow(get(raw.commandId));
  });
 }
 function paste(v){if(!keys(v,'commandId,text,sender,channel')||!uuid(v.commandId)||!['correo','whatsapp','telegram','telefono','otro'].includes(v.channel))throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);const data={text:text(v.text,8000),sender:text(v.sender,200,true),channel:v.channel},identity=hash(data),old=db.all('SELECT * FROM awos_intake_messages WHERE command_id=?',v.commandId)[0];if(old){if(old.identity_hash!==identity)throw new AwosError('AWOS_COMMAND_CONFLICT');return source(old.message_id);}db.run('BEGIN IMMEDIATE');try{const id=db.inbox.create({...data,analysis:{via:{target:'synthetic',label:'Pegado manual; sin conector'},summary:'Solicitud pegada para revisión de contacto.'}});db.run('INSERT INTO awos_intake_messages VALUES (?,?,?)',v.commandId,identity,id);db.run('COMMIT');return source(id);}catch(e){db.run('ROLLBACK');throw e;}}
 return {paste,preview,capture,resume:async id=>{const r=get(id);if(!r)throw new AwosError('AWOS_INTAKE_NOT_FOUND',404);return locked(r.message_id,()=>resumeRow(r));},list:()=>db.all('SELECT * FROM awos_intakes ORDER BY created_at DESC LIMIT 100').map(publicRow)};
}
