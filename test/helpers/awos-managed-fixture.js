import {copyFixture} from './awos-copy-fixture.js';import {createAwosMaintenance} from '../../src/awos-maintenance.js';import {createAwosCopyService} from '../../src/awos-copy-service.js';import {acquireAwosLocks} from '../../src/awos-locks.js';import {startAwos} from '../../src/awos-process.js';import {createAwosFlow} from '../../src/awos-flow.js';
export async function managedFixture(t,options={}){
 let cleanup;const f=await copyFixture({after:fn=>cleanup=fn}),gate=createAwosMaintenance(),release=acquireAwosLocks(f.config);let host=f.host,service,closing=false,starts=0;
 const pause=fn=>gate.run(async()=>{await host.close();try{return await fn();}finally{if(!closing){options.beforeRestart?.();host=await startAwos(f.config);starts++;}}});
 const factory=()=>createAwosCopyService({config:f.config,withPaused:pause,resumeRuntime:()=>gate.run(async()=>{if(!host.ready()){host=await startAwos(f.config);starts++;}}),runtimeReady:()=>host.ready(),...options});service=factory();
 t.after(async()=>{closing=true;await service.close();await host.close();release();await cleanup();});
 return {...f,get service(){return service;},get host(){return host;},gate,flow:()=>createAwosFlow(f.db,host.client),get starts(){return starts;},reopen:async()=>{await service.close();service=factory();}};
}
