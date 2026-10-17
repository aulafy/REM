import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {launch,tenant} from './fixtures/pyme1-harness.js';
test('experimental CRM exposes only scoped synthetic contact commands; journal idempotency survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pyme1-crm-contract-')),token='synthetic-contact-command-token-123456';let f=await launch(dir,token);
 const call=async(method:string,path:string,body?:unknown,auth=token)=>{const r=await fetch(`http://127.0.0.1:${f.port}/v1/workspaces/${tenant}${path}`,{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json() as Record<string,any>};};
 try{
  const revision=(await call('GET','/crm')).body.revision,id='p1-contact-'+'a'.repeat(64),command={commandId:'p1-capture-contract',expectedRevision:revision,operation:{type:'contact.create',id,name:'Ficción',email:'fiction@example.test',phone:'600123456',notes:'Solo prueba',relationship:'prospect'}};
  assert.equal((await call('POST','/crm/commands',command,'wrong')).status,401);
  for(const operation of [{type:'lead.create',id:'blocked-lead',contactId:'qa-elena',title:'No permitido',line:'other'},{...command.operation,id:'qa-elena'},{...command.operation,email:'personal@gmail.com'}])assert.equal((await call('POST','/crm/commands',{...command,operation})).status,403);
  assert.equal((await call('POST','/crm/commands',{...command,execute:true})).status,400);
  const first=await call('POST','/crm/commands',command);assert.equal(first.status,200);assert.equal(first.body.result.contactId,id);assert.equal((await call('GET','/crm')).body.totalContacts,3);
  assert.deepEqual((await call('POST','/crm/commands',command)).body.result,first.body.result);
  await f.close();f=await launch(dir,token);assert.deepEqual((await call('POST','/crm/commands',command)).body.result,first.body.result);assert.equal((await call('GET','/crm')).body.totalContacts,3);
  assert.equal((await call('POST','/crm/commands',{commandId:'update-contract',expectedRevision:first.body.result.revision,operation:{type:'contact.update',id,name:'Ficción revisada',phone:'600123456',notes:'Dato ficticio',relationship:'prospect',status:'active'}})).status,200);
  for(const route of ['execute','reconcile','cancel','reprepare'])assert.equal((await call('POST',`/runtime/p1-a-v1/email/${route}`,{})).status,404);
 }finally{await f.close();rmSync(dir,{recursive:true,force:true});}
});
