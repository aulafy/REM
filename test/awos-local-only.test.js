import test from 'node:test';import assert from 'node:assert/strict';import {assertLocalModel} from '../src/local-only.js';import {draftAwos} from '../src/awos-drafter.js';
const cfg={enabled:true,url:'http://127.0.0.1:11434',model:'test-local'};
test('modelo local: rechaza URL externa, cloud, metadata remota y redirecciones',async()=>{
 let calls=0;const fetcher=async(_u,opts)=>{calls++;assert.equal(opts.redirect,'error');return new Response(JSON.stringify({remote_host:'cloud.test'}));};
 await assert.rejects(assertLocalModel({...cfg,url:'https://example.test'},fetcher),/LOCAL/);assert.equal(calls,0);
 await assert.rejects(assertLocalModel(cfg,fetcher),/REMOTE/);
 await assert.rejects(assertLocalModel({...cfg,model:'foo:cloud'},async()=>new Response(JSON.stringify({model_info:{architecture:'synthetic'}}))),/REMOTE/);
 assert.deepEqual(await assertLocalModel(cfg,async()=>new Response(JSON.stringify({model_info:{architecture:'synthetic'}}))),{url:cfg.url,model:cfg.model});
});
test('redactor integrado recibe solo nombre, canal y petición; conserva borrador y aviso de fecha',async()=>{
 let req;const request='Agradece a Elena su ayuda.',out=await draftAwos({local:cfg},{id:'qa-elena',name:'Elena Soler',notes:'Póliza del 30 de diciembre'},request,{fetcher:async()=>new Response(JSON.stringify({model_info:{architecture:'synthetic'}})),chat:async(_cfg,r)=>{req=r;return {text:JSON.stringify({asunto:'Gracias',texto:'Gracias por tu ayuda. Revisado el 30 de diciembre de 2030.'})};}});
 assert.deepEqual(JSON.parse(req.messages[0].content),{cliente:'Elena Soler',canal:'correo',peticion:request});assert.ok(!JSON.stringify(req).includes('Póliza'));assert.ok(out.body.includes('2030'));assert.ok(out.avisosFecha.length>0);
});
test('transporte real del redactor solo llama a show/chat locales, bloquea redirects y no acepta herramientas',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push(url);assert.equal(options.redirect,'error');return new Response(JSON.stringify(url.endsWith('/api/show')?{model_info:{architecture:'synthetic'}}:{done:true,message:{content:JSON.stringify({asunto:'Gracias',texto:'Gracias por tu ayuda.'})}}));};
 const out=await draftAwos({local:cfg},{name:'Mila'},'Agradece a Mila su ayuda.',{fetcher});assert.equal(out.body,'Gracias por tu ayuda.');assert.deepEqual(calls,[cfg.url+'/api/show',cfg.url+'/api/chat']);
 await assert.rejects(draftAwos({local:cfg},{name:'Mila'},'Gracias',{fetcher:async url=>new Response(JSON.stringify(url.endsWith('/api/show')?{model_info:{architecture:'synthetic'}}:{done:true,message:{content:'{}',tool_calls:[{}]}}))}),/DRAFT_INVALID/);
});
