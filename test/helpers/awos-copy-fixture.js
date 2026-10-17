import {freePort} from './free-port.js';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {experimentalConfig} from '../../src/awos-guard.js';import {startAwos} from '../../src/awos-process.js';import {openDb} from '../../src/db.js';import {createAwosFlow} from '../../src/awos-flow.js';import {awosRepo} from './awos-harness.js';
export async function copyFixture(t){
 const root=mkdtempSync(join(tmpdir(),'pyme1-copy-test-')),dataDir=join(root,'data'),runtimeDir=join(root,'runtime'),output=join(root,'copies');for(const p of [dataDir,runtimeDir,output])mkdirSync(p,{mode:0o700});
 const config=experimentalConfig({PYME1_AWOS_EXPERIMENTAL:'1',PYME1_DATA_DIR:dataDir,PYME1_AWOS_DIR:runtimeDir,PYME1_AWOS_REPO:awosRepo,PYME1_PORT:String(await freePort()),PYME1_SECRETS:'memory',PYME1_AWOS_PLANNER:'synthetic'});
 writeFileSync(join(root,'qa-config.json'),JSON.stringify({root,data:dataDir,runtime:runtimeDir,port:config.port,planner:'synthetic'}),{mode:0o600});
 let host=await startAwos(config),db=openDb(join(dataDir,'pyme1.db')),closed=false;
 const flow=createAwosFlow(db,host.client);db.clients.create({name:'Cliente sintético local'});
 async function stop(){if(closed)return;closed=true;await host.close();db.close();}
 t.after(async()=>{await stop();rmSync(root,{recursive:true,force:true});});
 return {root,config,output,repo:awosRepo,db,flow,get host(){return host;},stop};
}
