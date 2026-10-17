import {startAwos} from '../../src/awos-process.js';import {createAwosFlow} from '../../src/awos-flow.js';import {openDb} from '../../src/db.js';
const [configText,file,inputText,phase]=process.argv.slice(2),config=JSON.parse(configText),input=JSON.parse(inputText);
const host=await startAwos(config),db=openDb(file);
const flow=createAwosFlow(db,host.client,{hook:stage=>{if(stage===phase){process.send?.({stage,pid:host.child.pid},()=>process.kill(process.pid,'SIGKILL'));}}});
await flow.prepare(input);await new Promise(r=>setTimeout(r,2000));throw Error('CRASH_HOOK_NOT_REACHED');
