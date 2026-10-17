import {resolveLanguage,draftLanguageInstruction} from './language.js';
import {draftingRequest} from './draft-context.js';
import {assertLocalModel} from './local-only.js';
import {extractJson} from './ai/json.js';
import {nowDate} from './clock.js';
import {unexpectedDates} from './draft-dates.js';
// This experimental transport is loopback-only, without redirects or external fallback.
async function localDraftChat(config,req,fetcher){
 const res=await fetcher(config.url+'/api/chat',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(60_000),body:JSON.stringify({model:config.model,stream:false,think:false,options:{temperature:0.2},format:req.schema,messages:[{role:'system',content:req.system},...req.messages]})});
 if(!res.ok)throw Error('AWOS_LOCAL_MODEL_UNAVAILABLE');
 const reader=res.body?.getReader();if(!reader)throw Error('AWOS_DRAFT_INVALID');let length=0;const chunks=[];
 try{for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>65536)throw Error('AWOS_DRAFT_LIMIT');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
 const data=JSON.parse(Buffer.concat(chunks).toString());
 if(data.remote_host||data.remote_model)throw Error('AWOS_REMOTE_MODEL_DENIED');
 if(data.done!==true||typeof data.message?.content!=='string'||data.message.tool_calls?.length)throw Error('AWOS_DRAFT_INVALID');
 return {text:data.message.content};
}
export async function draftAwos(settings,contact,request,{fetcher=fetch,chat,language}={}){
 const local=await assertLocalModel(settings.local,fetcher);
 const db={clients:{list:()=>[{...contact,notes:''}],findByName:()=>null},tasks:{list:()=>[]}};
 const base=nowDate();const req=draftingRequest(db,request,base,{clientName:contact.name,channel:'correo',language:resolveLanguage(language,settings.language)});
 const out=await (chat??((cfg,r)=>localDraftChat(cfg,r,fetcher)))({enabled:true,...local},{system:req.system,messages:req.messages,json:true,schema:{type:'object',properties:{asunto:{type:'string'},texto:{type:'string'}},required:['asunto','texto'],additionalProperties:false}});
 const data=extractJson(out.text);
 if(!data||typeof data.asunto!=='string'||typeof data.texto!=='string'||!data.texto.trim())throw Error('AWOS_DRAFT_INVALID');
 return {subject:data.asunto,body:data.texto,avisosFecha:unexpectedDates(request,data,base),provider:'local',model:local.model};
}
export async function suggestProposalText(settings,{kind,cliente,servicio,language},{fetcher=fetch,chat}={}){
 if(!['condiciones','introduccion'].includes(kind)||typeof cliente!=='string'||cliente.length>120||typeof servicio!=='string'||servicio.length>200)throw Error('AWOS_DRAFT_INVALID');
 const local=await assertLocalModel(settings.local,fetcher),schema={type:'object',properties:{texto:{type:'string'}},required:['texto'],additionalProperties:false};
 const prompt=`Propón únicamente ${kind==='condiciones'?'unas condiciones comerciales breves':'una introducción breve'} para una propuesta ficticia. Cliente: ${cliente}. Servicio: ${servicio}. No afirmes envíos, aprobaciones, pagos ni acciones realizadas.`;
 const out=await (chat??((cfg,r)=>localDraftChat(cfg,r,fetcher)))({enabled:true,...local},{system:'Eres un redactor local. Devuelve una sugerencia editable en texto plano, sin HTML. '+draftLanguageInstruction(resolveLanguage(language,settings.language)),messages:[{role:'user',content:prompt}],schema});
 const data=extractJson(out.text);if(!data||typeof data.texto!=='string'||!data.texto.trim()||data.texto.length>2000)throw Error('AWOS_DRAFT_INVALID');return {text:data.texto.trim(),suggestion:true,kind,provider:'local',model:local.model};
}
