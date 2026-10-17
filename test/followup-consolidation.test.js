import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {execFileSync} from 'node:child_process';
import {openDb} from '../src/db.js';import {createAwosFollowups} from '../src/awos-followups.js';import {operationHtml} from '../public/awos-panel.js';import {allowedNumbers,unexpectedNumbers} from '../src/numbers.js';import {followupCommands} from '../public/followup-controls.js';
const root=()=>({opId:randomUUID(),version:1,latest:true,state:'ready',taskId:'synthetic',template:{variables:{cliente:'Cliente ficticio',servicio:'Prueba'}},desired:{to:'cliente@example.test',subject:'Propuesta',contactId:'qa-elena'},remote:{effects:[],audit:[]}});

test('UTC due time renders as local wall time and round-trips in Madrid across DST',()=>{
 const script=`import assert from 'node:assert/strict';import {followupLocalValue,followupInstant} from './public/followup-controls.js';import {operationHtml} from './public/awos-panel.js';for(const [iso,local]of [['2026-10-20T10:00:00.000Z','2026-10-20T12:00'],['2026-10-27T10:00:00.000Z','2026-10-27T11:00']]){assert.equal(followupLocalValue(iso),local);assert.equal(followupInstant(local),iso);assert.ok(operationHtml({opId:'synthetic',version:1,latest:true,state:'ready',template:{},remote:{effects:[]}},[],iso).includes('value="'+local+'"'));}assert.throws(()=>followupInstant('2027-03-28T02:30'),/does not exist/);assert.equal(followupLocalValue('invalid'),'');`;
 execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{PATH:process.env.PATH,TZ:'Europe/Madrid'}});
});
test('multiple authorized date references allow their day/year only, not a generic calendar',()=>{
 const dates=['2026-10-20','2026-10-22'];assert.ok(allowedNumbers('',dates).has('20'));assert.deepEqual(unexpectedNumbers('',{texto:'El 20 y el 22 de 2026.'},dates),[]);assert.deepEqual(unexpectedNumbers('',{texto:'El 21 y el importe 650.'},dates),['21','650']);
});
test('a non-template review has no schedule control; stale and uncertain sources cannot prepare',()=>{
 const op=root();assert.match(operationHtml(op),/data-followup-schedule/);assert.doesNotMatch(operationHtml({...op,template:null}),/data-followup-schedule/);
 const f={id:randomUUID(),op_id:op.opId,version:1,state:'due',due_at:'2026-10-20T10:00:00.000Z'};
 for(const next of [{...op,latest:false},{...op,state:'uncertain'},{...op,state:'failed'}])assert.doesNotMatch(operationHtml(next,[f]),/data-followup-prepare/);
});
test('schedule retry retains UUID on a lost response; changed input is a different command',()=>{
 let n=0;const commands=followupCommands({makeId:()=>`synthetic-${++n}`}),v={opId:'synthetic',version:1,dueAt:'2026-10-20T10:00:00.000Z',note:''};assert.equal(commands.input(v).commandId,commands.input({...v}).commandId);assert.notEqual(commands.input({...v,note:'Otro motivo'}).commandId,'synthetic-1');commands.confirmed(v);assert.equal(commands.input(v).commandId,'synthetic-3');
});
test('preparing cannot race with dismiss and overwrite a durable decision',async t=>{
 const db=openDb(':memory:');t.after(()=>db.close());const op=root();let release,started;const startedPromise=new Promise(ok=>started=ok),wait=new Promise(ok=>release=ok);
 const flow={get:async()=>op,prepare:async()=>{started();await wait;return {state:'approval'};}};let now=new Date('2026-10-17T10:00:00.000Z');const f=createAwosFollowups(db,flow,{clock:()=>now});const row=await f.schedule({opId:op.opId,version:1,commandId:randomUUID(),dueAt:'2026-10-17T11:00:00.000Z'});now=new Date('2026-10-17T12:00:00.000Z');await f.tick();const preparing=f.prepare(row.id);await startedPromise;
 try{assert.throws(()=>f.dismiss(row.id,'No continuar'),/AWOS_FOLLOWUP_BUSY/);await assert.rejects(f.prepare(row.id),/AWOS_FOLLOWUP_BUSY/);}finally{release();await preparing;}assert.equal(f.get(row.id).state,'drafted');
});
test('replacement during preparation preserves superseded state and the created review link',async t=>{
 const db=openDb(':memory:');t.after(()=>db.close());const op=root();let release,started;const startedPromise=new Promise(ok=>started=ok),wait=new Promise(ok=>release=ok);let now=new Date('2026-10-17T10:00:00.000Z');const f=createAwosFollowups(db,{get:async()=>op,prepare:async()=>{started();await wait;return {state:'approval'};}},{clock:()=>now});const row=await f.schedule({opId:op.opId,version:1,commandId:randomUUID(),dueAt:'2026-10-17T11:00:00.000Z'});now=new Date('2026-10-17T12:00:00.000Z');await f.tick();const preparing=f.prepare(row.id);await startedPromise;f.supersede(op.opId,1);release();await assert.rejects(preparing,/AWOS_FOLLOWUP_SOURCE_BLOCKED/);assert.equal(f.get(row.id).state,'superseded');assert.ok(f.get(row.id).followup_op_id);
});
