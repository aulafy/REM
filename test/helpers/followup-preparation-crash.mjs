import {writeSync} from 'node:fs';import {join} from 'node:path';
import {openDb} from '../../src/db.js';import {startAwos} from '../../src/awos-process.js';import {createAwosFlow} from '../../src/awos-flow.js';import {createAwosFollowups} from '../../src/awos-followups.js';
const [root,repo,id]=process.argv.slice(2),db=openDb(join(root,'pyme1.db')),host=await startAwos({runtimeDir:join(root,'runtime'),repo,planner:'synthetic'}),flow=createAwosFlow(db,host.client);
const followups=createAwosFollowups(db,{get:flow.get,prepare:async input=>{const op=await flow.prepare(input);writeSync(1,JSON.stringify({taskId:op.taskId,reviewId:op.remote.review.id,hostPid:host.child.pid})+'\n');process.kill(process.pid,'SIGKILL');}});
await followups.prepare(id);throw Error('CRASH_NOT_REACHED');
