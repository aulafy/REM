import {writeSync} from 'node:fs';import {join} from 'node:path';import {openDb} from '../../src/db.js';import {startAwos} from '../../src/awos-process.js';import {loadCopySource} from '../../src/awos-archive.js';import {createAwosIntakes} from '../../src/awos-intakes.js';
const [root,repo,raw,phase]=process.argv.slice(2),config=loadCopySource(root,repo),db=openDb(join(config.dataDir,'pyme1.db')),host=await startAwos(config);
const service=createAwosIntakes(db,host.client,{hook:(stage,r)=>{if(stage===phase){writeSync(1,JSON.stringify({id:r.command_id,hostPid:host.child.pid})+'\n');process.kill(process.pid,'SIGKILL');}}});
await service.capture(JSON.parse(raw));throw Error('CRASH_NOT_REACHED');
