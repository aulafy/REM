import test from 'node:test';import assert from 'node:assert/strict';import {operationHtml} from '../public/awos-panel.js';import {displayState} from '../src/awos-flow.js';
test('mapping de estados respeta las dos proyecciones y no interpreta unknown como fallo',()=>{for(const [raw,state]of Object.entries({plan_ready:'draft',waiting_approval:'approval',approved:'ready',unknown:'uncertain'}))assert.equal(displayState({status:raw}),state);});
test('UNKNOWN y versiones previas nunca presentan botones de aprobación ni borrado',()=>{
 const op={opId:'qa',version:1,latest:true,state:'uncertain',remote:{status:'unknown',effects:[{status:'unknown'}],audit:[]}};
 const h=operationHtml(op);assert.match(h,/Uncertain result: do not resend/);assert.ok(!h.includes('<button'));
 const old=operationHtml({...op,latest:false,state:'ready',remote:{review:{payload:{from:'office@example.test',to:['qa@example.test'],body:'<script>alert(1)</script>',subject:'Prueba'},bindingHash:'a'.repeat(64)},decision:{decision:'approved',userId:'owner'},effects:[],audit:[]}});
 assert.ok(!old.includes('<button'));assert.ok(!old.includes('<script>'));assert.match(old,/its original decision is retained/);assert.match(old,/Approved — not sent/);
});
test('supersession is displayed only with authoritative AWOS evidence; the old decision remains history',()=>{
 const h=operationHtml({opId:'qa',version:1,latest:false,state:'cancelled',remote:{effects:[],audit:[],runtimeReplacement:{replacementTaskId:'successor',canReplace:false},decision:{decision:'approved',userId:'owner'}}});
 assert.match(h,/Superseded — sending blocked/);assert.match(h,/Supersession recorded in AWOS/);assert.match(h,/Decision: approved/);assert.ok(!h.includes('<button'));
});
test('long AWOS content is escaped and approval is never presented as sending',()=>{
 const long='Cliente & Asociados <script>'.repeat(80),h=operationHtml({opId:'long',taskId:long,version:2,latest:true,state:'ready',remote:{review:{payload:{from:long,to:[long],subject:long,body:long},bindingHash:'b'.repeat(64)},decision:{decision:'approved',userId:'owner'},effects:[],audit:[]}});
 assert.ok(!h.includes('<script>'));assert.match(h,/&lt;script&gt;/);assert.match(h,/Approved — not sent/);assert.match(h,/Sending is disabled/);assert.doesNotMatch(h,/>Send</);
});
