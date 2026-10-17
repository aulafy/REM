import {test} from 'node:test';
import assert from 'node:assert/strict';
import {absoluteDates,relativePeriods,draftingDateReferences,draftingDatesPrompt,unexpectedDates} from '../src/draft-dates.js';
import {draftingRequest} from '../src/draft-context.js';
import {dateWarningsHtml} from '../public/proposal-warnings.js';
import {openDb} from '../src/db.js';
import {makeSecrets} from '../src/secrets.js';
import {loadSettings,saveSettings} from '../src/settings.js';
import {askAgent,normalizeAction} from '../src/agent.js';
const base=new Date(2026,9,10,12);
test('plazos relativos no reciben equivalencias absolutas; fechas de tareas siguen separadas',()=>{
 for(const request of ['Caduca en 24 días','Llega en una semana','Lo revisamos dentro de 8 días','Necesitamos dos semanas']){
  assert.equal(relativePeriods(request).length,1);assert.equal(draftingDateReferences(request,base).length,0);assert.doesNotMatch(draftingDatesPrompt(request,base),/2026|octubre/);
 }
 assert.deepEqual(draftingDateReferences('En 24 días vence y el lunes llamamos',base).map(r=>r.date),['2026-10-12']);
});
test('equivalencias solo de la petición; hoy no se autoriza por defecto',()=>{
 assert.deepEqual(draftingDateReferences('El jueves confirmamos',base).map(r=>r.date),['2026-10-15']);
 assert.equal(unexpectedDates('El jueves confirmamos',{texto:'El miércoles 14 de octubre de 2026'},base).length,1);
 assert.deepEqual(unexpectedDates('El jueves confirmamos',{texto:'El jueves 15 de octubre de 2026'},base),[]);
 assert.equal(unexpectedDates('Gracias',{texto:'Hoy, 10 de octubre'},base).length,1);
 assert.deepEqual(unexpectedDates('Gracias por tu ayuda hoy',{texto:'Hoy, 10 de octubre'},base),[]);
});
test('fechas numéricas, españolas, abreviadas y escritas con palabras se comparan por fecha',()=>{
 for(const text of ['2026-10-17','17/10/2026','17/10','17 oct 2026','diecisiete de octubre de 2026','sábado 17','el día 17'])assert.equal(absoluteDates(text,base)[0].date,'2026-10-17',text);
 assert.deepEqual(unexpectedDates('Quedamos el 17/10/2026',{texto:'El diecisiete de octubre de 2026'},base),[]);
 assert.equal(unexpectedDates('Precio 17 euros',{texto:'El 17 de octubre'},base).length,1);
});
test('un importe o teléfono con los mismos números no autoriza una fecha completa',()=>{
 assert.equal(unexpectedDates('Costará 20 euros y puedes llamar al 600202610',{texto:'Entrega el 20 de octubre de 2026'},base).length,1);
 assert.deepEqual(unexpectedDates('La oferta dura en una semana',{texto:'La oferta dura en una semana'},base),[]);
});
test('varias fechas legítimas admitidas; una fecha ajena adicional genera aviso',()=>{
 const request='Hoy recibimos y el viernes confirmamos';
 assert.deepEqual(unexpectedDates(request,{texto:'Recibido el 10 de octubre de 2026; confirmaremos el 16 de octubre de 2026'},base),[]);
 assert.deepEqual(unexpectedDates(request,{texto:'Recibido el 10 de octubre de 2026; confirmaremos el 13 de octubre de 2026'},base),['13 de octubre de 2026']);
});
test('la frontera no introduce fechas para un agradecimiento ni plazos relativos',t=>{
 const db=openDb(':memory:');t.after(()=>db.close());
 for(const request of ['Gracias por la ayuda','Caduca en 24 días por 185 euros']){
  const req=draftingRequest(db,request,base);assert.doesNotMatch(req.system+JSON.stringify(req.messages),/2026|Próximos días|Hoy es|octubre/);
 }
});
function context(t,text){const db=openDb(':memory:');t.after(()=>db.close());saveSettings(db,{local:{model:'falso'},privacy:'local-only'});db.clients.create({name:'Nora Alba',phone:'600123400'});return{db,secrets:makeSecrets({mode:'memory'}),settings:()=>loadSettings(db),now:()=>base,providers:{chatLocal:async(_cfg,req)=>({text:JSON.stringify(req.system.startsWith('Eres un clasificador')?{intencion:{opcion:'mensaje',confianza:.9},multiples:{probabilidad:0}}:{cliente:'Nora',canal:'correo',asunto:'Respuesta',texto:text})})}};}
test('borrador con fecha ajena permanece literal y pendiente, con y sin reglas',async t=>{
 const body='La oferta caduca el 17 de octubre de 2026.';
 for(const rules of [true,false]){
  const ctx=context(t,body);ctx.rules=rules;const r=await askAgent(ctx,'Escribe a Nora un correo: caduca en una semana',{prefer:'local'});
  assert.equal(r.proposals[0].payload.texto,body);assert.deepEqual(r.proposals[0].payload.avisosFecha,['17 de octubre de 2026']);assert.equal(r.proposals[0].status,'pending');assert.equal(ctx.db.proposals.get(r.proposals[0].id).payload.texto,body);assert.equal(ctx.db.proposals.recent().length,0);assert.equal(ctx.db.audit.list().length,0);
 }
});
test('borrador correcto conserva el plazo; fecha legítima no genera avisos',async t=>{
 const ctx=context(t,'La oferta de 185 euros caduca en 24 días.');const r=await askAgent(ctx,'Escribe a Nora un correo: la oferta de 185 euros caduca en 24 días',{prefer:'local'});
 assert.deepEqual(r.proposals[0].payload.avisosFecha,[]);assert.deepEqual(r.proposals[0].payload.avisos,[]);assert.match(r.proposals[0].payload.texto,/en 24 días/);
 const other=context(t,'El viernes 16 de octubre de 2026 vence la factura.');const r2=await askAgent(other,'Prepara un correo a Nora: el viernes vence la factura',{prefer:'local'});assert.deepEqual(r2.proposals[0].payload.avisosFecha,[]);assert.deepEqual(r2.proposals[0].payload.avisos,[]);
});
test('normalización conserva avisos de fecha sin introducir controles ni HTML ejecutable',()=>{
 const payload=normalizeAction({tipo:'redactar_mensaje',texto:'Texto exacto',avisosFecha:['17 de octubre',null]});assert.deepEqual(payload.avisosFecha,['17 de octubre']);
 const html=dateWarningsHtml(['<img src=x onerror=alert(1)>']);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/Dates to review/);assert.ok(!html.includes('button'));assert.equal(dateWarningsHtml([]),'');
});
test('fecha literal con weekday no se recalcula; día sin mes usa solo su equivalencia',()=>{
 assert.equal(draftingDateReferences('El martes 12 de octubre de 2026',base).length,0);
 assert.deepEqual(unexpectedDates('El martes 12 de octubre de 2026',{texto:'El 12 de octubre de 2026'},base),[]);
 assert.equal(unexpectedDates('El martes 12 de octubre de 2026',{texto:'El 13 de octubre de 2026'},base).length,1);
 const later=new Date(2026,9,21,12);
 assert.deepEqual(unexpectedDates('El día 10 confirmamos',{texto:'El 10 de noviembre de 2026'},later),[]);
 assert.equal(unexpectedDates('El día 10 confirmamos',{texto:'El 10 de octubre de 2026'},later).length,1);
});
