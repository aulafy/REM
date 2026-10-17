// Test-only observation. Preserve listen arguments and errors unchanged; record
// the real occupied-port attempts instead of guessing when a free probe expires.
import {Server} from 'node:net';
const original=Server.prototype.listen;
Server.prototype.listen=function(...args){
 const port=typeof args[0]==='number'?args[0]:args[0]?.port;
 process.stdout.write(`QA_LISTEN ${JSON.stringify({kind:'attempt',port})}\n`);
 this.once('error',error=>process.stdout.write(`QA_LISTEN ${JSON.stringify({kind:'error',port,code:error.code})}\n`));
 return Reflect.apply(original,this,args);
};
