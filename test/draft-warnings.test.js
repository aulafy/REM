// Regresión de borradores con cifras y de su presentación antes de aprobar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { makeSecrets } from '../src/secrets.js';
import { saveSettings, loadSettings } from '../src/settings.js';
import { askAgent } from '../src/agent.js';
import { triage } from '../src/triage.js';
import { approveProposal } from '../src/actions.js';
import { unexpectedNumbers } from '../src/numbers.js';
import { warningsHtml } from '../public/proposal-warnings.js';
function fixture(t, draft) {
 const db=openDb(':memory:');t.after(()=>db.close());saveSettings(db,{local:{model:'simulado'},privacy:'local-only'});
 db.clients.create({name:'Sol Medina',phone:'600001010',notes:'Tarifa acordada: 70 euros'});
 return {db,secrets:makeSecrets({mode:'memory'}),settings:()=>loadSettings(db),now:()=>new Date(2026,9,10,12),providers:{chatLocal:async(_cfg,req)=>({text:JSON.stringify(req.system.startsWith('Eres un clasificador')?{intencion:{opcion:'mensaje',confianza:.9},multiples:{probabilidad:0}}:{cliente:'Sol',canal:'whatsapp',asunto:'',texto:draft})})}};
}
test('viernes 16 y año resueltos conservan el borrador sin aviso',async(t)=>{
 const ctx=fixture(t,'Hola Sol: el viernes 16 de octubre de 2026 vence la factura.');
 const r=await askAgent(ctx,'Recuérdale a Sol que el viernes vence la factura');
 assert.equal(r.proposals.length,1);assert.deepEqual(r.proposals[0].payload.avisos,[]);assert.match(r.proposals[0].payload.texto,/16/);assert.equal(r.proposals[0].status,'pending');
});
test('importe inventado genera aviso visible y conserva el mensaje pendiente, incluso sin reglas',async(t)=>{
 for(const rules of [true,false]){
  const ctx=fixture(t,'La factura es de 999 euros.');ctx.rules=rules;
  const r=await askAgent(ctx,'Prepara un aviso de vencimiento para Sol');const p=r.proposals[0];
  assert.equal(p.kind,'redactar_mensaje');assert.deepEqual(p.payload.avisos,['999']);assert.match(warningsHtml(p.payload.avisos),/Review: the draft includes 999, which was not in your request/);assert.equal(p.status,'pending');
  assert.deepEqual(ctx.db.proposals.get(p.id).payload.avisos,['999']);assert.equal(ctx.db.audit.list().length,0);
 }
});
test('permite teléfono y cifras de la ficha única; otro contacto no aporta permiso',async(t)=>{
 const ctx=fixture(t,'Tarifa 70 euros. Teléfono 600001010.');const r=await askAgent(ctx,'Prepara un mensaje para Sol');assert.deepEqual(r.proposals[0].payload.avisos,[]);
 assert.deepEqual(unexpectedNumbers('Gracias',{texto:'Teléfono 600002020'},'',ctx.db.clients.findByName('Sol'),{card:true}),['600002020']);
});
test('aprobar un borrador mantiene su aviso e historial; solo después registra la aprobación',async(t)=>{
 const ctx=fixture(t,'Debes pagar 999 euros');const r=await askAgent(ctx,'Prepara un aviso para Sol');const id=r.proposals[0].id;
 assert.equal(ctx.db.proposals.recent().length,0);const done=await approveProposal(ctx,id);assert.equal(done.status,'approved');assert.deepEqual(done.payload.avisos,['999']);assert.equal(ctx.db.audit.list()[0].kind,'mensaje_aprobado');
});
test('avisos de la tarjeta no permiten inyectar HTML y no crean controles de ejecución',()=>{
 assert.equal(warningsHtml([]),'');const html=warningsHtml(['<script>alert(1)</script>','999']);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/role="note"/);assert.ok(!html.includes('button'));
});
test('el clasificador conserva el borrador y avisa de cifras no sustentadas',async(t)=>{
 const ctx=fixture(t,'');ctx.providers.chatLocal=async(_cfg,req)=>({text:JSON.stringify(req.system.startsWith('Eres un clasificador')?{categoria:{opcion:'administrativo',confianza:.9},urgencia:{nivel:1,confianza:.9},responder:{probabilidad:1}}:{resumen:'Pregunta de factura',respuesta:'La factura es de 555 euros.',tarea:{titulo:'',fecha:''}})});
 const r=await triage(ctx,{text:'¿Cuándo vence mi factura?',sender:'Sol Medina',channel:'correo'});assert.equal(r.proposals.length,1);assert.deepEqual(r.proposals[0].payload.avisos,['555']);assert.equal(r.proposals[0].status,'pending');
});
