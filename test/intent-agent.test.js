// Flujo semántico con respuestas sintéticas: no usa frases del examen ni llama a un modelo real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { makeSecrets } from '../src/secrets.js';
import { saveSettings, loadSettings } from '../src/settings.js';
import { askAgent, INTENT_QUESTIONS, mergeActions } from '../src/agent.js';
import { safeAction } from '../src/intents.js';
import { taskTitle } from '../src/dates.js';
const fixed = new Date(2026,9,10,12);
function fixture(t, { intent='tarea', confidence=.9, multiple=false, extracted={}, general={respuesta:'Propuestas',acciones:[]}, rules=true }={}) {
 const db=openDb(':memory:'); t.after(()=>db.close());
 saveSettings(db,{local:{model:'simulado'},decision:{kind:'custom',url:'http://127.0.0.1:1'},privacy:'allow'});
 const calls=[];
 const ctx={db,rules,secrets:makeSecrets({mode:'memory'}),settings:()=>loadSettings(db),now:()=>fixed,
 callDecision:async (_cfg,_key,req)=>{ calls.push({decision:req}); return {model:'simulado',answers:{intencion:{choice:intent,confidence},multiples:{noul:multiple?1:0}}}; },
 providers:{chatLocal:async (_cfg,req)=>{calls.push(req);return {text:JSON.stringify(req.schema?.properties.acciones?general:req.system.startsWith('Eres un redactor')&&!extracted.texto?general.acciones.find(a=>a.tipo==='redactar_mensaje')||extracted:extracted)};}},
 };
 return {ctx,calls};
}
test('clasifica con runDecision y extrae con esquema pequeño; conserva el reloj y no ejecuta', async(t)=>{
 const {ctx,calls}=fixture(t,{extracted:{titulo:'Revisar inventario mañana',cliente:''}});
 const r=await askAgent(ctx,'Debo revisar el inventario mañana');
 assert.equal(calls.length,2);assert.equal('contexto' in calls[0].decision.state,false);assert.equal(calls[0].decision.state.peticion_actual,'Debo revisar el inventario mañana');assert.match(calls[1].messages.at(-1).content,/DATOS LOCALES/);assert.match(calls[1].system,/Claves exactas/);assert.equal(calls[0].decision.questions,INTENT_QUESTIONS);assert.deepEqual(Object.keys(calls[1].schema.properties),['titulo','cliente']);
 assert.equal(r.proposals[0].payload.fecha,'2026-10-11');assert.equal(r.proposals[0].payload.titulo,'Revisar inventario');assert.equal(ctx.db.tasks.list().length,0);assert.equal(r.message.meta.generalUsed,false);
});
test('sin fecha en la petición deja la fecha vacía aunque el extractor añada una',async(t)=>{
 const {ctx}=fixture(t,{extracted:{titulo:'Revisar inventario',cliente:'',fecha:'2099-01-01'}});
 assert.equal((await askAgent(ctx,'Revisar inventario')).proposals[0].payload.fecha,'');
});
test('limpia expresiones temporales y conserva la mañana como parte de la actividad',()=>{
 assert.equal(taskTitle('llamar a Sol mañana',fixed),'Llamar a Sol');assert.equal(taskTitle('Revisar balance el día 19',fixed),'Revisar balance');
 assert.equal(taskTitle('Abrir por la mañana',fixed),'Abrir por la mañana');assert.equal(taskTitle('Inspeccionar dentro de 4 días',fixed),'Inspeccionar');
});
test('contactos extraídos validan la procedencia literal del correo y teléfono',async(t)=>{
 const {ctx}=fixture(t,{intent:'cliente_nuevo',extracted:{nombre:'Nora Peña',email:'nora@example.invalid',telefono:'600001001',notas:''}});
 const r=await askAgent(ctx,'Registro de Nora Peña: nora@example.invalid y 600001001');
 assert.equal(r.proposals[0].payload.email,'nora@example.invalid');assert.equal(r.proposals[0].payload.telefono,'600001001');assert.equal(ctx.db.clients.list().length,0);
 const safe=safeAction({tipo:'crear_cliente',nombre:'Nora',email:'otra@example.invalid',telefono:'999999999'},'nora@example.invalid',ctx.db);
 assert.equal(safe.email,'');assert.equal(safe.telefono,'');
});
test('una nota requiere findByName único y no crea un cliente nuevo',async(t)=>{
 const {ctx}=fixture(t,{intent:'nota_cliente',extracted:{cliente:'Sol',texto:'Prefiere atención presencial'}});
 ctx.db.clients.create({name:'Sol Medina'});
 let r=await askAgent(ctx,'Guarda la preferencia de Sol');assert.equal(r.proposals[0].payload.cliente,'Sol Medina');assert.equal(ctx.db.clients.list()[0].notes,'');
 ctx.db.clients.create({name:'Sol Núñez'});r=await askAgent(ctx,'Guarda la preferencia de Sol');assert.equal(r.proposals.length,0);
});
test('consulta y conversación solo responden y no se traducen a operaciones',async(t)=>{
 for (const intent of ['consulta','conversacion']) {
  const {ctx,calls}=fixture(t,{intent,extracted:{respuesta:'Información del contexto',acciones:[{tipo:'crear_tarea',titulo:'No solicitada'}]}});
  const r=await askAgent(ctx,'Consulta sintética');assert.equal(r.proposals.length,0);assert.equal(r.message.content,'Información del contexto');assert.deepEqual(Object.keys(calls[1].schema.properties),['respuesta']);
 }
});
test('petición múltiple fusiona la extracción y conserva todas las acciones generales',async(t)=>{
 const {ctx}=fixture(t,{intent:'cliente_nuevo',multiple:true,extracted:{nombre:'Nora Peña',email:'nora@example.invalid',telefono:'',notas:''},general:{respuesta:'Propuestas',acciones:[{tipo:'crear_tarea',titulo:'Comprobar existencias'},{tipo:'redactar_mensaje',canal:'correo',cliente:'Sol',texto:'Hola'}]}});
 const r=await askAgent(ctx,'Registra Nora Peña nora@example.invalid, revisa existencias y prepara un correo');
 assert.deepEqual(r.proposals.map(p=>p.kind),['crear_tarea','redactar_mensaje','crear_cliente']);assert.equal(r.message.meta.generalUsed,true);
});
test('fusión no sustituye datos existentes ni duplica la misma acción; admite dos tareas distintas',()=>{
 const old={tipo:'crear_cliente',nombre:'Nora Peña',notas:'Del primer modelo'};
 const merged=mergeActions([old,{tipo:'crear_tarea',titulo:'Revisar stock'}],[{tipo:'crear_cliente',nombre:'Nora Pena'},{tipo:'crear_tarea',titulo:'Llamar al proveedor'}]);
 assert.equal(merged.length,3);assert.equal(merged[0],old);assert.equal(merged[0].notas,'Del primer modelo');
});
test('confianza baja activa la llamada general y registra esa decisión',async(t)=>{
 const {ctx,calls}=fixture(t,{intent:'conversacion',confidence:.2,extracted:{respuesta:'Aclaremos'},general:{respuesta:'Propuesta general',acciones:[{tipo:'crear_tarea',titulo:'Comprobar stock'}]}});
 const r=await askAgent(ctx,'Petición ambigua');assert.equal(calls.length,3);assert.equal(r.message.meta.generalUsed,true);assert.equal(r.proposals.length,1);
});
test('sin reglas desactiva la seguridad de intents y el fallback general; sigue el flujo del modelo',async(t)=>{
 const {ctx,calls}=fixture(t,{intent:'cliente_nuevo',confidence:.1,multiple:true,rules:false,extracted:{nombre:'Nora Peña',email:'inventado@example.invalid',telefono:'',notas:''}});
 const r=await askAgent(ctx,'Alta sintética');assert.equal(calls.length,2);assert.equal(r.message.meta.generalUsed,false);assert.equal(r.proposals[0].payload.email,'inventado@example.invalid');
});
test('emulación real del contrato de intención incluye choice y el esquema cerrado',async(t)=>{
 const {ctx,calls}=fixture(t);saveSettings(ctx.db,{decision:{kind:'none'},privacy:'local-only'});
 ctx.providers.chatLocal=async(_cfg,req)=>{calls.push(req);return {text:JSON.stringify(req.system.startsWith('Eres un clasificador')?{intencion:{opcion:'consulta',confianza:.9},multiples:{probabilidad:0}}:{respuesta:'No hay tareas'})};};
 const r=await askAgent(ctx,'Pregunta sintética',{prefer:'local'});
 assert.equal(r.message.meta.intent,'consulta');assert.equal(r.proposals.length,0);assert.match(calls[0].system,/cliente_nuevo/);assert.doesNotMatch(calls[0].messages[0].content,/Opciones:/);assert.deepEqual(calls[0].schema.properties.intencion.properties.opcion.enum,Object.keys(INTENT_QUESTIONS.intencion.criteria));
});
test('selección Solo IA local no contacta al modelo de decisión externo',async(t)=>{
 const {ctx}=fixture(t);let external=false;ctx.callDecision=async()=>{external=true;throw new Error('No debe salir');};
 ctx.providers.chatLocal=async(_cfg,req)=>({text:JSON.stringify(req.system.startsWith('Eres un clasificador')?{intencion:{opcion:'conversacion',confianza:.9},multiples:{probabilidad:0}}:{respuesta:'Hola'})});
 await askAgent(ctx,'Saludo sintético',{prefer:'local'});assert.equal(external,false);assert.equal(ctx.db.audit.list().length,0);
});
test('fusión completa campos vacíos sin cambiar datos que ya estaban presentes',()=>{
 const merged=mergeActions([{tipo:'crear_cliente',nombre:'Nora Peña',email:'',notas:'Historia conservada'}],[{tipo:'crear_cliente',nombre:'Nora Peña',email:'nora@example.invalid',notas:'Otra historia'}]);
 assert.equal(merged.length,1);assert.equal(merged[0].email,'nora@example.invalid');assert.equal(merged[0].notas,'Historia conservada');
});

test('discrepancia con confianza alta consulta el general y fusiona un borrador sin perder la tarea', async(t)=>{
 const {ctx,calls}=fixture(t,{intent:'tarea',confidence:.98,extracted:{cliente:'Sol',canal:'correo',asunto:'Inventario',texto:'Sol: el domingo estará listo el inventario.'},general:{respuesta:'Para revisar',acciones:[{tipo:'crear_tarea',titulo:'Revisar inventario'}]}});
 const r=await askAgent(ctx,'Redacta para Sol un email indicando que el domingo terminamos el inventario');
 assert.equal(calls.length,3);assert.equal(r.message.meta.disagreement,true);assert.equal(r.message.meta.modelIntent,'tarea');assert.equal(r.message.meta.intent,'mensaje');
 assert.deepEqual(r.proposals.map(p=>p.kind),['crear_tarea','redactar_mensaje']);assert.equal(ctx.db.tasks.list().length,0);
 assert.match(calls[1].system,/domingo = domingo,? 11 de octubre de 2026/);assert.match(calls[2].system,/domingo = domingo,? 11 de octubre de 2026/);
});
test('autorrecordatorio prevalece sobre el verbo de escribir sin ejecutar nada',async(t)=>{
 const {ctx}=fixture(t,{intent:'mensaje',extracted:{titulo:'Escribir a Sol el domingo',cliente:'Sol'},general:{respuesta:'Revisa',acciones:[]}});
 const r=await askAgent(ctx,'Apúntame escribir a Sol el domingo');
 assert.equal(r.message.meta.intent,'tarea');assert.equal(r.message.meta.generalUsed,true);assert.equal(r.proposals[0].kind,'crear_tarea');assert.equal(r.proposals[0].payload.titulo,'Escribir a Sol');assert.equal(r.proposals[0].payload.fecha,'2026-10-11');
});
test('sin reglas conserva la decisión equivocada del modelo y no aplica desempate',async(t)=>{
 const {ctx,calls}=fixture(t,{intent:'tarea',confidence:.98,rules:false,extracted:{titulo:'Escribir a Sol',cliente:'Sol'}});
 const r=await askAgent(ctx,'Redacta para Sol un email indicando que el domingo terminamos el inventario');
 assert.equal(calls.length,2);assert.equal(r.message.meta.signal,null);assert.equal(r.message.meta.intent,'tarea');assert.equal(r.message.meta.generalUsed,false);assert.match(calls[1].system,/2026-10-11/);
});
