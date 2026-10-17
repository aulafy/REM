/** Experimental host: synthetic stores only, no execute/reconcile route or real connector. */
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync,openSync,closeSync,realpathSync,lstatSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalJsonProvider,parseStructuredPlan,type InferenceProvider,type PlanContext} from '@agent-world/inference';
import {openWorkspaceRuntime} from '../../src/runtime-source.js';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../../src/workspace-api.js';
import {handlePymesRequest} from '../../src/api-server.js';
import {parseCrmCommand} from '../../src/crm-contract.js';

export const tenant='pyme1-local',owner='pyme1-owner';
export const contacts=[{id:'qa-elena',name:'Elena Soler',email:'elena@example.test'}, {id:'qa-luis',name:'Luis Vidal',email:'luis@example.test'}];
export const actions=['email.identify_contact','crm.lookup_contact','crm.propose_lead','email.classify','email.draft_reply','email.review_reply','email.send_reply','crm.record_interaction','crm.create_followup'];
const targets=['email.incoming','crm.local','crm.local','email.incoming','email.reply','email.reply','email.reply','crm.local','crm.local'];
export const deterministicProvider:InferenceProvider={id:'synthetic-plan',capabilities:async()=>['structured_output'],health:async()=>({ok:true,provider:'synthetic-plan',endpoint:'http://127.0.0.1',authConfigured:false}),proposePlan:async(_c:PlanContext)=>({plan:{actions:actions.map((a,i)=>({action:a,targetId:targets[i],parameters:{}}))} as never,rawText:'synthetic',latencyMs:0})};
export function ollamaPlanProvider():InferenceProvider{
 const provider=new LocalJsonProvider({kind:'ollama',baseUrl:process.env.LLAMA_BASE_URL,model:process.env.LLAMA_MODEL,timeoutMs:60_000});
 return {id:'ollama-json-plan',capabilities:async()=>['structured_output'],health:async()=>({ok:true,provider:'ollama-json-plan',endpoint:process.env.LLAMA_BASE_URL??'',authConfigured:false}),proposePlan:async(context,options)=>{
  const r=await provider.proposeJson({system:'Propose, never execute. Return exactly the listed workflow actions in their required order, with matching entity targets and empty parameters.\n'+(context.constraints??[]).join('\n'),data:context,schema:{type:'object',properties:{actions:{type:'array',items:{type:'object',properties:{action:{type:'string',enum:context.availableActions},targetId:{type:'string',enum:context.entities.map(e=>e.id)},parameters:{type:'object',additionalProperties:false}},required:['action','targetId','parameters'],additionalProperties:false}}},required:['actions'],additionalProperties:false}},options?.signal);
  return {plan:parseStructuredPlan(JSON.stringify(r.value)),rawText:'',model:r.model,latencyMs:r.latencyMs};
 }};
}
export function allowedPath(method:string,path:string){
 const root='/v1/workspaces/'+tenant;
 if(method==='GET')return path===root+'/capsules/modules'||path===root+'/crm'||new RegExp('^'+root+'/crm/workflows/p1-[a-f0-9-]+-v[0-9]+$').test(path)||path===root+'/review-queue'||new RegExp('^'+root+'/runtime/p1-[a-f0-9-]+-v[0-9]+/email$').test(path);
 return method==='POST'&&(path===root+'/capsules/modules/configure'||path===root+'/runtime'||path===root+'/crm/commands'||new RegExp('^'+root+'/runtime/p1-[a-f0-9-]+-v[0-9]+/(plan|email/(draft|review|decision|replace))$').test(path));
}
export async function launch(dir:string,token:string,provider:InferenceProvider=deterministicProvider){
 if(!token||token.length<24)throw Error('QA_TOKEN_REQUIRED');
 const root=realpathSync(tmpdir()),r=relative(root,realpathSync(dir));
 if(!r||r.startsWith('..')||isAbsolute(r)||lstatSync(dir).isSymbolicLink())throw Error('QA_TEMP_REQUIRED');
 const lock=join(dir,'runtime.lock');
 try {const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('QA_LOCK_INVALID');try{process.kill(pid,0);throw Error('QA_RUNTIME_IN_USE');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}unlinkSync(lock);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));closeSync(fd);
 const runtime=await openWorkspaceRuntime(join(dir,'runtime.db'),tenant,{fakeEmail:true,provider,planningTimeoutMs:60_000});
 const repo=new InMemoryWorkspaceRepository();repo.addSession(token,{userId:owner,tenantId:tenant,role:'owner'});
 // Included modules preserve existing QA capabilities; never re-enable an existing disabled installation.
 for(const item of runtime.source.capsules!.modules(tenant,owner).items)if(!item.installation){const c=runtime.source.capsules!.modules(tenant,owner);runtime.source.capsules!.configureModule(tenant,owner,{sdkVersion:2,commandId:'seed-'+item.manifest.id.replaceAll('.','-'),expectedRevision:c.revision,capsuleId:item.manifest.id,version:item.manifest.version,enabled:true,grants:item.manifest.capabilities,config:item.manifest.defaults});}
 for(const c of contacts){const v=runtime.source.crm!.view(tenant,owner,'',null,'all');runtime.source.crm!.command(tenant,owner,{commandId:'seed-'+c.id,expectedRevision:v.revision,operation:{type:'contact.create',...c,phone:'',notes:'Contacto sintético de integración',relationship:'prospect'}});}
 const api=new WorkspaceApi(repo,undefined,runtime.source);
 const calls:string[]=[];
 const server=createServer(async(req,res)=>{
  try {
   const path=new URL(req.url!,'http://127.0.0.1').pathname;
   if(!allowedPath(req.method!,path)){res.writeHead(404);res.end(JSON.stringify({error:'QA_ROUTE_DISABLED'}));return;}
   calls.push(req.method+' '+path);
   const chunks:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>100_000)throw Error('QA_BODY_LIMIT');chunks.push(Buffer.from(b));}
   const body=Buffer.concat(chunks);
   if(path.endsWith('/crm/commands')){
    // Existing CRM contract, narrowly exposed for this synthetic host only.
    let input;try{input=parseCrmCommand(JSON.parse(body.toString()));}catch{res.writeHead(400);res.end(JSON.stringify({error:'QA_CRM_INPUT_INVALID'}));return;}
    const op=input.operation;
    const task=/^p1-[a-f0-9-]+-v[1-9][0-9]*$/;
    const allowed=(op.type==='contact.create'||op.type==='contact.update')&&/^p1-contact-[a-f0-9]{64}$/.test(op.id)&&(op.type!=='contact.create'||op.email===''||/^[^@\s]+@example\.test$/.test(op.email))
      ||op.type==='workflow.followup'&&task.test(op.id)&&task.test(op.sourceTaskId)
      ||op.type==='lead.update'&&/^[a-f0-9]{64}$/.test(op.id)&&['won','lost'].includes(op.status)
      ||op.type==='interaction.note'&&/^p1-response-[a-f0-9-]{36}$/.test(op.id);
    if(!allowed){res.writeHead(403);res.end(JSON.stringify({error:'QA_CRM_OPERATION_DISABLED'}));return;}
   }
   const out=await handlePymesRequest(api,new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers as Record<string,string>,...(body.length?{body}:{})}),{allowedOrigins:[]});
   res.writeHead(out.status,Object.fromEntries(out.headers));res.end(await out.text());
  }catch{res.writeHead(500);res.end(JSON.stringify({error:'QA_REQUEST_FAILED'}));}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 let closed=false;
 return {runtime,repo,api,calls,port:(server.address() as import('node:net').AddressInfo).port,close:async()=>{if(closed)return;closed=true;repo.revokeSession(token);server.closeIdleConnections();await new Promise<void>(r=>server.close(()=>r()));runtime.close();unlinkSync(lock);}};
}
if(process.argv[1]?.endsWith('pyme1-harness.ts')){
 for(const k of Object.keys(process.env))if(/^PYMES_(GMAIL_|TELEGRAM_|OPENCLAW_|WHATSAPP_|.*_GATEWAY_|API_WORKER_TOKEN)/.test(k))throw Error('QA_CONNECTOR_ENV_DENIED');
 const dir=process.env.PYME1_AWOS_DIR!,token=process.env.PYME1_AWOS_TOKEN!;
 mkdirSync(dir,{recursive:true,mode:0o700});
 const host=await launch(dir,token,process.env.PYME1_AWOS_PLANNER==='local'?ollamaPlanProvider():deterministicProvider);
 process.send?.({type:'ready',port:host.port,tenant,owner,planner:process.env.PYME1_AWOS_PLANNER==='local'?'local':'synthetic'});
 const close=()=>host.close().then(()=>process.exit(0));process.on('disconnect',close);process.on('SIGTERM',close);process.on('SIGINT',close);
}
