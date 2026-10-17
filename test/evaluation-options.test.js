// Contratos del evaluador; no llama a Ollama.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArgs, loadFixture, summarize, checkCase } from '../scripts/eval.js';
import { unexpectedNumbers } from '../src/numbers.js';

test('opciones: casos alternativos, sin reglas y repeticiones enteras', () => {
  assert.deepEqual(parseArgs(['--model','m','--casos','eval/examen.json','--sin-reglas','--repeticiones','3']), {model:'m',casesFile:'eval/examen.json',rules:false,repetitions:3});
  assert.equal(parseArgs([]).repetitions,1);
  for (const args of [['--repeticiones','0'],['--repeticiones','1.5'],['--repeticiones','NaN'],['--casos'],['--desconocido']]) assert.throws(() => parseArgs(args));
});
test('examen independiente hereda solo el fixture ausente y conserva sus 36 casos', () => {
  const base = loadFixture().fixture, exam = loadFixture('eval/examen.json').fixture;
  assert.equal(exam.cases.length,36); assert.deepEqual(exam.clients,base.clients); assert.deepEqual(exam.tasks,base.tasks); assert.equal(exam.clock,base.clock);
  assert.deepEqual(exam.cases,JSON.parse(readFileSync(new URL('../eval/examen.json',import.meta.url))).cases);
});
test('media y mínimo por familia reflejan variabilidad entre repeticiones', () => {
  const summary = summarize([{type:'tarea',repetition:1,passed:true,ms:10},{type:'tarea',repetition:1,passed:true,ms:20},{type:'tarea',repetition:2,passed:false,ms:30},{type:'tarea',repetition:2,passed:false,ms:40}]);
  assert.equal(summary.types.tarea.meanPercent,50); assert.equal(summary.types.tarea.minPercent,0); assert.equal(summary.total.percent,50); assert.equal(summary.meanMs,25); assert.equal(summary.p90Ms,40);
});
test('criterio numérico permite día y año resueltos y teléfono; mantiene fallo por importe nuevo', () => {
  const client={name:'Persona sintética',phone:'600000888'};
  const p={asunto:'',texto:'El viernes 16 de octubre de 2026 vence. Mi teléfono es 600000888.'};
  assert.deepEqual(unexpectedNumbers('El viernes vence',p,'2026-10-16',client),[]);
  assert.deepEqual(unexpectedNumbers('El viernes vence',{texto:'Debes pagar 999 euros'},'2026-10-16',client),['999']);
  const db={tasks:{list:()=>[1,2,3]},clients:{list:()=>[1,2,3,4],findByName:()=>client},proposals:{recent:()=>[]},errands:{list:()=>[]}};
  const result={proposals:[{kind:'redactar_mensaje',status:'pending',payload:{...p,cliente:client.name,canal:'correo'}}]};
  assert.equal(checkCase({type:'mensaje',text:'El viernes vence',expected:{channel:'correo'}},result,db).find(x=>x.name==='sin cifras inventadas').ok,true);
});
test('sin reglas no añade operaciones de respaldo si el modelo no las extrae', async(t)=>{
 const {openDb}=await import('../src/db.js');const {askAgent}=await import('../src/agent.js');const {loadSettings,saveSettings}=await import('../src/settings.js');const {makeSecrets}=await import('../src/secrets.js');
 const db=openDb(':memory:');t.after(()=>db.close());saveSettings(db,{local:{model:'simulado'}});let calls=0;
 const ctx={db,rules:false,secrets:makeSecrets({mode:'memory'}),settings:()=>loadSettings(db),providers:{chatLocal:async()=>{calls++;return{text:'{"respuesta":"Sin propuesta","acciones":[]}'}}}};
 assert.equal((await askAgent(ctx,'Crea un cliente llamado Nora con correo nora@example.invalid')).proposals.length,0);
 assert.equal((await askAgent(ctx,'Prepárame un correo para Nora')).proposals.length,0);assert.equal(calls,4);
});
test('repeticiones ejecutadas usan una base nueva por caso y registran los intentos', async(t)=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {evaluate}=await import('../scripts/eval.js');
 const dir=mkdtempSync(join(tmpdir(),'pyme1-eval-opciones-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'casos.json');writeFileSync(path,JSON.stringify({cases:[{id:'saludo-sintetico',type:'consulta',text:'Hola',expected:{terms:[]}}]}));let calls=0;
 const r=await evaluate({model:'simulado',casesFile:path,rules:false,repetitions:2,resultsDir:dir,provider:async()=>{calls++;return{text:'{"respuesta":"Hola","acciones":[]}'}}});
 assert.equal(r.rows.length,2);assert.deepEqual(r.rows.map(x=>x.repetition),[1,2]);assert.equal(r.summary.total.minPercent,100);assert.equal(calls,4);assert.equal(r.rules,false);
});
