import test from 'node:test';import assert from 'node:assert/strict';import {draftAwos} from '../src/awos-drafter.js';
test('regresión de estado operativo: contexto no filtra revisiones y prompt prohíbe afirmar ejecución; no falsea el texto del modelo',async()=>{
 let prompt;const raw='Hemos revisado tu póliza.';
 const r=await draftAwos({local:{enabled:true,url:'http://127.0.0.1:11434',model:'synthetic'}},{name:'Mila Sierra',notes:'Revisión pendiente'},'Confirma la cita para revisar la póliza.',{fetcher:async()=>new Response(JSON.stringify({model_info:{architecture:'synthetic'}})),chat:async(_cfg,req)=>{prompt=req;return {text:JSON.stringify({asunto:'Revisión',texto:raw})};}});
 assert.match(prompt.system,/No supongas que se ha enviado o ejecutado nada/);assert.ok(!JSON.stringify(prompt.messages).includes('Revisión pendiente'));assert.equal(r.body,raw);
 // This regression proves the data boundary, not that every LLM obeys the prompt.
});
