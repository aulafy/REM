import test from 'node:test';import assert from 'node:assert/strict';import {createAwosMaintenance} from '../src/awos-maintenance.js';import {createServer} from 'node:http';import {openDb} from '../src/db.js';import {createApp} from '../src/api.js';

test('maintenance drains admitted work, refuses new mutations and releases on failure',async()=>{
 const gate=createAwosMaintenance(),leave=gate.enter();let ran=false;const done=gate.run(async()=>{ran=true;throw Error('FAILED_COPY');});assert.equal(ran,false);assert.throws(()=>gate.enter(),/MAINTENANCE/);leave();leave();await assert.rejects(done,/FAILED_COPY/);const next=gate.enter();next();
});
test('timeout never cancels or replays an in-flight business action',async()=>{
 const gate=createAwosMaintenance({timeoutMs:10}),leave=gate.enter();let actions=0;await assert.rejects(gate.run(()=>actions++),/DRAIN_TIMEOUT/);assert.equal(actions,0);leave();await gate.run(()=>actions++);assert.equal(actions,1);gate.close();assert.throws(()=>gate.enter(),/MAINTENANCE/);await assert.rejects(gate.run(()=>actions++),/MAINTENANCE/);
});
test('API business barrier retains token/origin checks; control status remains available during drain',async t=>{
 const db=openDb(':memory:');t.after(()=>db.close());const gate=createAwosMaintenance();let admitted,release;const started=new Promise(r=>admitted=r),unblock=new Promise(r=>release=r);
 const secrets={where:'memory',get:async()=>{admitted();await unblock;return null;}};let port;const server=createServer(createApp({db,secrets,token:'qa',staticDir:'public',getPort:()=>port,maintenance:gate,copies:{status:async()=>({enabled:true,busy:true})}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;t.after(()=>server.close());
 const call=(path,body,headers={})=>fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'x-pyme1-token':'qa','content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const pending=call('/api/state');await started;let captured=false;const copy=gate.run(()=>captured=true);assert.equal((await call('/api/clients',{name:'Refused'})).status,503);assert.equal(db.clients.list().length,0);assert.equal((await call('/api/awos/copies')).status,200);assert.equal((await call('/api/awos/copies',undefined,{'x-pyme1-token':'bad'})).status,401);assert.equal((await call('/api/awos/copies',undefined,{origin:'https://foreign.invalid'})).status,403);release();assert.equal((await pending).status,200);await copy;assert.equal(captured,true);
});
