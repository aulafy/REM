import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../src/db.js';
import {makeSecrets} from '../src/secrets.js';
import {saveSettings,loadSettings} from '../src/settings.js';
import {draftContext,draftingRequest} from '../src/draft-context.js';
import {askAgent} from '../src/agent.js';
import {triage} from '../src/triage.js';
const base=new Date(2026,9,10,12);
function fixture(t){
 const db=openDb(':memory:');t.after(()=>db.close());
 const c=db.clients.create({name:'Nora Alba',email:'nora@example.invalid',phone:'600100200',notes:'Su póliza vence el 28 de octubre. Incidencia ajena: expediente X908.'});
 db.clients.create({name:'Iris Alba',notes:'Secreto de otro contacto X333.'});
 db.tasks.create({title:'Revisar póliza de Nora',due:'2026-10-12',client_id:c.id});
 db.tasks.create({title:'Cita de Nora',due:'2026-10-13',client_id:c.id});
 db.tasks.create({title:'Incidencia de Iris',due:'2030-11-30',client_id:2});
 db.chat.add('user','El estado anterior era pendiente de aprobación X777.');
 saveSettings(db,{local:{model:'simulado'},privacy:'local-only'});
 return {db,secrets:makeSecrets({mode:'memory'}),settings:()=>loadSettings(db),now:()=>base};
}
test('redactor recibe solo cliente canal y literal: no ficha, historial ni reloj',t=>{
 const ctx=fixture(t),req=draftingRequest(ctx.db,'Escribe un correo a Nora agradeciendo su ayuda',base);
 assert.deepEqual(Object.keys(req.input),['cliente','canal','peticion']);assert.equal(req.input.cliente,'Nora Alba');assert.equal(req.messages.length,1);
 assert.doesNotMatch(req.system+JSON.stringify(req.messages),/X908|X333|X777|600100200|28 de octubre|2026-|Próximos días|Hoy es/);
});
test('datos explícitos solo del cliente y clase referida; no de otras tareas',t=>{
 const ctx=fixture(t),req=draftContext(ctx.db,'Escribe a Nora para recordarle la cita del martes',base);
 assert.deepEqual(req.input.datos_mencionados,[{fuente:'tarea',titulo:'Cita de Nora',fecha:'2026-10-13'}]);
 const policy=draftContext(ctx.db,'Confirma a Nora la revisión de su póliza',base);
 assert.ok(policy.input.datos_mencionados.some(x=>x.fuente==='nota'&&x.texto.includes('28')));
 assert.ok(policy.input.datos_mencionados.every(x=>!JSON.stringify(x).includes('X908')));
 assert.equal(draftContext(ctx.db,'Prepara una nota de agradecimiento para Nora',base).input.datos_mencionados,undefined);
});
test('identidad ambigua no permite filtrar datos de una ficha',t=>{
 const ctx=fixture(t);ctx.db.clients.create({name:'Nora Vidal',notes:'No debe salir'});
 const req=draftContext(ctx.db,'Escribe a Nora recordándole su póliza',base);
 assert.equal(req.client,null);assert.equal(req.input.datos_mencionados,undefined);
});
test('fusión planifica sin texto y redacta cada mensaje solo con datos mínimos',async t=>{
 const ctx=fixture(t),calls=[];
 ctx.providers={chatLocal:async(_cfg,req)=>{calls.push(req);
  if(req.system.startsWith('Eres un clasificador'))return{text:JSON.stringify({intencion:{opcion:'cliente_nuevo',confianza:.9},multiples:{probabilidad:1}})};
  if(req.schema.properties.acciones){assert.equal(req.schema.properties.acciones.items.properties.texto,undefined);return{text:JSON.stringify({respuesta:'Propuestas',acciones:[{tipo:'crear_tarea',titulo:'Revisar inventario'},{tipo:'redactar_mensaje',cliente:'Nora Alba',canal:'correo'}]})};}
  if(req.system.startsWith('Eres un redactor')){assert.equal(req.messages.length,1);assert.deepEqual(Object.keys(JSON.parse(req.messages[0].content)),['cliente','canal','peticion']);assert.doesNotMatch(JSON.stringify(req.messages),/X777|X908|X333|600100200/);return{text:'{"cliente":"Nora Alba","canal":"correo","asunto":"Gracias","texto":"Gracias por tu ayuda."}'};}
  return{text:'{"nombre":"Otto","email":"otto@example.invalid","telefono":"","notas":""}'};
 }};
 const r=await askAgent(ctx,'Registra Otto otto@example.invalid y prepara un correo para Nora agradeciendo su ayuda',{prefer:'local'});
 assert.deepEqual(r.proposals.map(p=>p.kind),['crear_tarea','redactar_mensaje','crear_cliente']);assert.equal(r.proposals[1].payload.texto,'Gracias por tu ayuda.');assert.equal(ctx.db.proposals.recent().length,0);assert.equal(ctx.db.tasks.list().length,3);assert.equal(calls.filter(c=>c.system.startsWith('Eres un redactor')).length,1);
});
test('triage mantiene clasificación separada y minimiza también su redacción',async t=>{
 const ctx=fixture(t);ctx.providers={chatLocal:async(_cfg,req)=>{
  if(req.system.startsWith('Eres un clasificador'))return{text:'{"categoria":{"opcion":"administrativo","confianza":1},"urgencia":{"nivel":1},"responder":{"probabilidad":1}}'};
  assert.equal(req.messages.length,1);assert.deepEqual(Object.keys(JSON.parse(req.messages[0].content)),['cliente','canal','peticion']);assert.doesNotMatch(req.system+JSON.stringify(req.messages),/X908|X777|2026-10-10|Urgencia:/);
  return{text:'{"resumen":"Confirmación","respuesta":"Gracias, hemos recibido el archivo.","tarea":{"titulo":"","fecha":""}}'};
 }};
 const r=await triage(ctx,{sender:'Nora Alba',channel:'correo',text:'¿Puedes confirmar que llegó el archivo?'});assert.equal(r.proposals[0].status,'pending');assert.equal(r.proposals[0].payload.texto,'Gracias, hemos recibido el archivo.');
});
