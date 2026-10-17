import {runtimeReplacementFixture} from './runtime-mail-replacement-fixture.js';
const [dir,phase,inputText]=process.argv.slice(2);
if(!dir||!['before','inside','after'].includes(phase!))throw Error('CRASH_ARGUMENTS_INVALID');
const kill=()=>process.kill(process.pid,'SIGKILL');
const f=await runtimeReplacementFixture({dir,hooks:{...(phase==='before'?{beforePersist:kill}:{}),...(phase==='inside'?{afterParentCancelled:kill}:{}),...(phase==='after'?{afterPersist:kill}:{})}});
await f.post('root','replace',JSON.parse(inputText!));
throw Error('CRASH_HOOK_NOT_REACHED');
