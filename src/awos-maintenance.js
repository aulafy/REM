import {AwosError} from './awos-client.js';
// Requests already admitted finish normally. New business requests fail visibly
// while the host holds an exclusive maintenance barrier; they are never queued
// and replayed as an approval later.
export function createAwosMaintenance({timeoutMs=75_000}={}){
 let active=0,exclusive=false,closed=false,drained;
 function enter(){if(closed||exclusive)throw new AwosError('AWOS_MAINTENANCE',503);active++;let done=false;return ()=>{if(done)return;done=true;if(--active===0)drained?.();};}
 return {enter,busy:()=>exclusive,close:()=>{closed=true;},async run(fn){
  if(closed||exclusive)throw new AwosError('AWOS_MAINTENANCE',503);exclusive=true;let timer;
  try{if(active)await new Promise((ok,bad)=>{drained=ok;timer=setTimeout(()=>bad(new AwosError('AWOS_MAINTENANCE_DRAIN_TIMEOUT',409)),timeoutMs);});if(closed)throw new AwosError('AWOS_MAINTENANCE',503);return await fn();}
  finally{clearTimeout(timer);drained=null;exclusive=false;}
 }};
}
