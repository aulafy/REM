import test from 'node:test';import assert from 'node:assert/strict';import {copiesHtml,parseCopiesStatus,restoredUrl} from '../public/awos-copies.js';
const id='10000000-0000-4000-8000-000000000001',at=Date.now();
const data=()=>({enabled:true,busy:false,runtimeReady:true,copies:[{copyId:id,createdAt:new Date(at).toISOString(),manifestHash:'a'.repeat(64),bytes:4096,summary:{reviews:2,crmLeads:1}}],jobs:[]});
test('copy UI requires a fresh exact selection and explicit RESTAURAR; it never implies replacement or sending',()=>{
 const d=data(),h=copiesHtml(d,d.copies[0]);assert.match(h,/Type RESTAURAR/);assert.match(h,/current instance and its history are retained/);assert.match(h,/Sending remains disabled/);assert.match(h,/Create restored environment/);assert.ok(!h.includes('data-awos-decide'));assert.ok(!h.includes('Send now'));
});
test('error and maintenance render visible facts without demo content or restore actions for a broken copy',()=>{
 const d=data();d.busy=true;d.runtimeReady=false;d.copies=[{copyId:id,error:'AWOS_COPY_CHANGED'}];const h=copiesHtml(d);assert.match(h,/AWOS is unavailable/);assert.match(h,/recovery operation is in progress/i);assert.match(h,/has changed/);assert.ok(!h.includes('data-copy-select='));assert.ok(!h.includes('Invalid Date'));assert.match(h,/data-copy-create disabled/);
});
test('only verified loopback restored sessions can be linked, never the installed app or external URLs',()=>{
 for(const bad of ['http://127.0.0.1:4317/#awos','https://external.test/','javascript:alert(1)','http://127.0.0.1:9999/#else','http://user@127.0.0.1:9999/#awos'])assert.equal(restoredUrl(bad),null);
 const d=data();d.jobs=[{id,kind:'open',state:'completed',phase:'completed',error:null,created:at,updated:at,result:{url:'http://127.0.0.1:4999/#awos'}}];assert.match(copiesHtml(d),/rel="noopener noreferrer"/);d.jobs[0].result.url='https://elsewhere.test/';assert.throws(()=>copiesHtml(d),/verify/);
});
test('malformed results fail visibly instead of becoming an empty successful catalog',()=>{
 for(const d of [{enabled:true},{...data(),copies:'not an array'},{...data(),jobs:[{id:'bad'}]},{...data(),copies:[{copyId:id,manifestHash:'bad'}]}])assert.throws(()=>parseCopiesStatus(d));assert.equal(copiesHtml({enabled:false}),'');
});
test('initial read model waits through maintenance without replaying commands; unrelated failures stay visible',async()=>{
 const {loadAroundMaintenance}=await import('../public/awos-copies.js');let reads=0,waits=0,messages=0;const value=await loadAroundMaintenance(async()=>{reads++;if(reads<3)throw Object.assign(Error('copy in progress'),{code:'AWOS_MAINTENANCE'});return {actual:true};},()=>messages++,async()=>waits++);assert.deepEqual(value,{actual:true});assert.equal(reads,3);assert.equal(waits,2);assert.equal(messages,2);await assert.rejects(loadAroundMaintenance(async()=>{throw Object.assign(Error('auth'),{code:'TOKEN'});},()=>assert.fail('must not retry')),/auth/);
});

// A failed runtime must leave copy/recovery controls available to recover it.
test('runtime action lock excludes recovery controls on the same screen',async()=>{
 const {runtimeButtons}=await import('../public/awos-panel.js');
 const runtime={disabled:false,closest:()=>null},recovery={disabled:false,closest:()=>({id:'awos-copies'})};
 const section={querySelectorAll:()=>[runtime,recovery]};
 runtimeButtons(section).forEach(b=>b.disabled=true);
 assert.equal(runtime.disabled,true);assert.equal(recovery.disabled,false);
});

test('import control explains provenance and keeps restoration explicit and separate',()=>{
 const data={enabled:true,busy:false,runtimeReady:true,copies:[],jobs:[{id:'11111111-1111-1111-1111-111111111111',kind:'import',state:'running',phase:'selecting',error:null,result:null,created:1,updated:1}]};
 const html=copiesHtml(data);assert.match(html,/data-copy-import/);assert.match(html,/macOS dialog/);assert.match(html,/do not certify provenance/);assert.match(html,/not restored or opened automatically/);assert.match(html,/Select a folder/);assert.doesNotMatch(html,/data-copy-open/);
});
