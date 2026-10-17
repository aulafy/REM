import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openWorkspaceRuntime} from '../../src/runtime-source.js';
import {FakeEmailProvider} from '../../src/email-provider.js';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../../src/workspace-api.js';
import {deterministicProvider} from './pyme1-harness.js';
import type {RuntimeMailReplacementHooks,RuntimeMailReplaceInput} from '../../src/runtime-mail-replacement.js';
export async function runtimeReplacementFixture(options:{dir?:string;loseResponse?:boolean;rejectBeforeSend?:boolean;hooks?:RuntimeMailReplacementHooks}={}){
 const dir=options.dir??mkdtempSync(join(tmpdir(),'runtime-mail-replacement-'));mkdirSync(dir,{recursive:true});const path=join(dir,'runtime.db');
 const tenant='agency',owner='owner';let sender:FakeEmailProvider,runtime:Awaited<ReturnType<typeof openWorkspaceRuntime>>,api:WorkspaceApi,repo:InMemoryWorkspaceRepository;
 async function open(){
  sender=new FakeEmailProvider(path+'.test-email.db',{loseResponse:options.loseResponse,rejectBeforeSend:options.rejectBeforeSend});
  runtime=await openWorkspaceRuntime(path,tenant,{emailProvider:sender,provider:deterministicProvider,runtimeReplacementHooks:options.hooks});
  repo=new InMemoryWorkspaceRepository();repo.addSession('owner-token-123456789',{tenantId:tenant,userId:owner,role:'owner'});repo.addSession('other-token-123456789',{tenantId:tenant,userId:'other',role:'owner'});repo.addSession('reviewer-token-123456789',{tenantId:tenant,userId:owner,role:'reviewer'});
  api=new WorkspaceApi(repo,undefined,runtime.source);
  for(const [id,email]of [['contact','client@example.test'],['other-contact','other@example.test']]){const crm=runtime.source.crm!,view=crm.view(tenant,owner,'',null,'all');crm.command(tenant,owner,{commandId:'seed-'+id,expectedRevision:view.revision,operation:{type:'contact.create',id:id!,name:id!,email:email!,phone:'',notes:'',relationship:'prospect'}});}
 }
 await open();
 const post=(taskId:string,action:string,body:unknown,token='owner-token-123456789',t=tenant)=>api.handleAsync({method:'POST',path:`/v1/workspaces/${t}/runtime/${taskId}/email/${action}`,authorization:'Bearer '+token,body});
 const create=async(id='root',decision?:'approved'|'rejected')=>{
  runtime.source.createTask!(tenant,owner,{id,goal:'Preparar respuesta comercial sintética'});
  await runtime.source.planTask!(tenant,owner,{taskId:id,workflow:'email-lead-v1'});
  runtime.source.email!.saveDraft(id,owner,{to:'client@example.test',subject:'Presupuesto',body:'Primera versión.',contactId:'contact'});
  let v=await runtime.source.email!.propose(id,owner);
  if(decision)v=await runtime.source.email!.decide(id,owner,{bindingHash:v.review!.bindingHash,decision});return v;
 };
 const input=(id='root',replacementTaskId='next'):RuntimeMailReplaceInput=>({requestId:'replace-'+id,bindingHash:runtime.source.email!.view(id,owner).review!.bindingHash,replacementTaskId,to:'client@example.test',subject:'Presupuesto corregido',body:'Segunda versión exacta.',contactId:'contact'});
 const counts=()=>{const db=new DatabaseSync(path+'.test-email.db',{readOnly:true});try{return {calls:Number(db.prepare('SELECT COUNT(*) AS n FROM calls').get()!.n),receipts:Number(db.prepare('SELECT COUNT(*) AS n FROM receipts').get()!.n)};}finally{db.close();}};
 return {dir,path,tenant,owner,get runtime(){return runtime;},get api(){return api;},get repo(){return repo;},create,input,post,counts,reopen:async()=>{runtime.close();sender.close();await open();},done:async()=>{runtime.close();sender.close();if(!options.dir)rmSync(dir,{recursive:true,force:true});}};
}
