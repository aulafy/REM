import {writeSync} from 'node:fs';
import {createAwosCopy,restoreAwosCopy} from '../../src/awos-archive.js';
const [action,phase,json]=process.argv.slice(2),args=JSON.parse(json);
const stop=value=>{writeSync(1,JSON.stringify(value)+'\n');process.kill(process.pid,'SIGKILL');};
const hooks=phase==='before'?{beforePublish:stop}:{afterPublish:path=>stop({target:path})};
if(action==='create')await createAwosCopy({...args,hooks});
else if(action==='restore')await restoreAwosCopy({...args,hooks});
else throw Error('INVALID_CRASH_ARGUMENTS');
throw Error('CRASH_NOT_REACHED');
