import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {linguisticIntent} from '../src/intents.js';
import {dateReferences,datePrompt,resolveDate} from '../src/dates.js';
import {INTENT_EXAMPLES,INTENT_QUESTIONS} from '../src/agent.js';
test('señales gramaticales generales distinguen destinatario de autorrecordatorio',()=>{
 for(const request of ['Escribidle a Zoe por Telegram', 'Responder a Ivo con la confirmación', 'Prepara un SMS', 'Dile a Aina que vuelva', 'Mándale un correo a Zoe']) assert.equal(linguisticIntent(request),'mensaje',request);
 for(const request of ['Recuérdame responder a Ivo', 'Anota llamar a Zoe', 'Pon una tarea para redactar un correo', 'Apunta enviar el documento']) assert.equal(linguisticIntent(request),'tarea',request);
 assert.equal(linguisticIntent('Escribe a Zoe: recuérdame el número de albarán'),'mensaje');
 assert.equal(linguisticIntent('¿Cuántos clientes tengo?'),null);assert.equal(linguisticIntent('Preparar el inventario'),null);
});
test('fechas equivalentes por expresión incluyen varias y excluyen mañana como horario',()=>{
 const base=new Date(2027,0,8,12);
 const refs=dateReferences('El domingo confirmamos y dentro de 5 días entregamos',base);
 assert.deepEqual(refs.map(r=>r.date),['2027-01-10','2027-01-13']);assert.equal(resolveDate('domingo y dentro de 5 días',base),'');
 assert.match(datePrompt('pasado mañana',base),/2027-01-10/);assert.equal(dateReferences('Por la mañana abrimos',base).length,0);
 assert.equal(dateReferences('el día 0',base).length,0);
});
test('ejemplos propios no reproducen peticiones de ninguna batería de evaluación',()=>{
 const requests=['casos','examen','examen2','examen3'].flatMap(name=>{
  const data=JSON.parse(readFileSync(new URL(`../eval/${name}.json`,import.meta.url),'utf8'));
  return (data.casos||data.cases).map(c=>c.text);
 });
 assert.equal(requests.every(r=>typeof r==='string' && r.length>0),true);
 const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
 assert.equal(INTENT_EXAMPLES.length,6);
 for(const [example] of INTENT_EXAMPLES) assert.equal(requests.some(r=>norm(r)===norm(example)),false);
 assert.match(INTENT_QUESTIONS.intencion.instructions,/AHORA/);assert.match(INTENT_QUESTIONS.intencion.instructions,/no la convierte en tarea/);
});
