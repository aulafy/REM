import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {augmentExamen3} from '../scripts/eval-redactor-checks.js';
const fixture=JSON.parse(readFileSync(new URL('../eval/casos.json',import.meta.url)));
const row=(text,body,expected={channel:'correo'})=>({id:'h3-unit',text,expected,checks:[{name:'canal y texto',ok:true},{name:'sin cifras inventadas',ok:true}],result:{proposals:[{kind:'redactar_mensaje',payload:{cliente:'Luis',canal:'correo',texto:body}}]}});
const score=(...args)=>augmentExamen3(row(...args),fixture.clients);
test('examen3 mantiene los 16 casos aprobados y no altera las baterías existentes',()=>{
 const exam=JSON.parse(readFileSync(new URL('../eval/examen3.json',import.meta.url)));assert.equal(exam.cases.length,16);assert.equal(new Set(exam.cases.map(c=>c.id)).size,16);assert.ok(exam.cases.every(c=>c.type==='mensaje'));
 const untouched={id:'h-mensaje',checks:[{name:'criterio original',ok:false}]};assert.equal(augmentExamen3(untouched,fixture.clients),untouched);
});
test('criterio de números por petición: no se autorizan hoy ni otros weekdays',()=>{
 assert.equal(score('El martes confirmamos','El martes 13 de octubre de 2026').passed,true);
 assert.equal(score('El martes confirmamos','El lunes 12 de octubre de 2026').passed,false);
 assert.equal(score('Confirma la recepción','Hoy 10 de octubre de 2026').passed,false);
 assert.equal(score('Confirma la recepción hoy','Hoy 10 de octubre de 2026').passed,true);
 assert.equal(score('Confirma mañana','Hoy 10 de octubre de 2026').passed,false);
});
test('el scoring conserva los controles positivos, plazos literales e importes de examen3',()=>{
 assert.equal(score('Caduca en 15 días por 245 euros','Caduca en 15 días por 245 euros',{channel:'correo',relative:'en 15 días',requiredTerms:['245']}).passed,true);
 assert.equal(score('Caduca en 15 días por 245 euros','Caduca el 25 de octubre de 2026 por 245 euros',{channel:'correo',relative:'en 15 días',requiredTerms:['245']}).passed,false);
 assert.equal(score('Entrega el miércoles','Entrega la próxima semana',{channel:'correo',temporalAlternatives:['miércoles','14 de octubre','2026-10-14']}).passed,false);
 assert.equal(score('Entrega el miércoles','Entrega el miércoles 14 de octubre',{channel:'correo',temporalAlternatives:['miércoles','14 de octubre','2026-10-14']}).passed,true);
});
