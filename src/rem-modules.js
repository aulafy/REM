import {AwosError} from './awos-client.js';import {parseModuleCommand,ACTION_ROUTES} from '../public/module-contract.js';
// Uses the existing AWOS capsule configuration journal. No parallel registry or effect engine.
export function createRemModules(client){
 const catalog=()=>client.call('modules');
 async function configure(raw){let input;try{input=parseModuleCommand(raw);}catch{throw new AwosError('REM_MODULE_INPUT_INVALID',400);}await client.call('moduleConfigure',null,input);return catalog();}
 async function authorize(moduleId,action){if(!Object.hasOwn(ACTION_ROUTES,action))throw new AwosError('REM_MODULE_ACTION_DENIED',403);const state=await catalog(),item=state.items.find(i=>i.manifest.id===moduleId);if(!item||!item.installation?.enabled)throw new AwosError('REM_MODULE_DISABLED',409);if(item.installation.version!==item.manifest.version)throw new AwosError('REM_MODULE_VERSION_CHANGED',409);if(!item.manifest.actions.includes(action))throw new AwosError('REM_MODULE_ACTION_DENIED',403);return item;}
 async function forAction(action){const state=await catalog(),item=state.items.find(i=>i.installation?.enabled&&i.installation.version===i.manifest.version&&i.manifest.actions.includes(action));if(!item)throw new AwosError('REM_MODULE_DISABLED',409);return authorize(item.manifest.id,action);}
 return {catalog,configure,authorize,forAction};
}
