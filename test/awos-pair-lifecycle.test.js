import {freePort} from './helpers/free-port.js';
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {copyFixture} from './helpers/awos-copy-fixture.js';import {createAwosCopy} from '../src/awos-archive.js';
async function launch(f,t,port){port??=await freePort();
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','src/server.js'],{cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,PYME1_AWOS_EXPERIMENTAL:'1',PYME1_SECRETS:'memory',PYME1_DATA_DIR:f.config.dataDir,PYME1_AWOS_DIR:f.config.runtimeDir,PYME1_AWOS_REPO:f.repo,PYME1_AWOS_PLANNER:'synthetic',PYME1_PORT:String(port)},stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
 const exit=once(child,'exit');let stdout='',stderr='';child.stderr.on('data',b=>stderr+=b);
 const ready=new Promise((ok,bad)=>{const timer=setTimeout(()=>{child.kill('SIGTERM');bad(Error('QA_START_TIMEOUT'));},8000);child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('REM está funcionando')){clearTimeout(timer);ok();}});child.once('exit',()=>{clearTimeout(timer);bad(Error(stderr));});});
 return {child,exit,ready,port,stderr:()=>stderr};
}
test('experimental server holds both locks; duplicate startup fails before opening data; graceful close permits copying',async t=>{
 const f=await copyFixture(t);await f.flow.prepare({opId:crypto.randomUUID(),commandId:crypto.randomUUID(),expectedVersion:0,contactId:'qa-elena',request:'Agradece la documentación',subject:'Gracias',body:'Gracias.'});await f.stop();
 const first=await launch(f,t);await first.ready;
 await assert.rejects(createAwosCopy({config:f.config,repo:f.repo,output:f.output}),/PAIR_IN_USE/);
 const second=await launch(f,t,await freePort());await assert.rejects(second.ready,/PAIR_IN_USE/);assert.notEqual((await second.exit)[0],0);
 const url=`http://127.0.0.1:${first.port}/`,html=await (await fetch(url)).text(),token=html.match(/name="pyme1-token" content="([^"]+)"/)[1];
 const status=await (await fetch(url+'api/backups',{headers:{'x-pyme1-token':token}})).json();assert.equal(status.scope,'pyme1-only');
 const response=await fetch(url+'api/shutdown',{method:'POST',headers:{'x-pyme1-token':token,'content-type':'application/json'},body:'{}'});assert.equal(response.status,200);assert.equal((await first.exit)[0],0);
 assert.equal((await createAwosCopy({config:f.config,repo:f.repo,output:f.output})).verified.reviews,1);
});
