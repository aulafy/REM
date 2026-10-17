import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {startAwos} from '../../src/awos-process.js';import {createAwosFlow} from '../../src/awos-flow.js';import {openDb} from '../../src/db.js';
// Repository path is explicit and configurable; never start installed product or read its settings.
export const awosRepo=process.env.PYME1_AWOS_TEST_REPO||fileURLToPath(new URL('../../runtime/awos',import.meta.url));
export async function fixture(options={}){
 const root=mkdtempSync(join(tmpdir(),'pyme1-awos-test-'));
 const {mkdirSync}=await import('node:fs');const runtimeDir=join(root,'runtime');mkdirSync(runtimeDir);
 const config={runtimeDir,repo:awosRepo,planner:'synthetic'};
 let host=await startAwos(config);const db=openDb(join(root,'pyme1.db'));
 return {root,config,db,get host(){return host;},flow:()=>createAwosFlow(db,options.client??host.client,options),restart:async()=>{await host.close();host=await startAwos(config);},close:async()=>{await host.close();db.close();rmSync(root,{recursive:true,force:true});}};
}
