#!/usr/bin/env node
// Explicit offline developer tool. Nothing starts or overwrites an installed app.
import {createAwosCopy,restoreAwosCopy,inspectAwosCopy,loadCopySource} from '../src/awos-archive.js';
const args=process.argv.slice(2),mode=args.shift(),known={create:['--source','--awos','--output'],restore:['--copy','--awos','--port'],inspect:['--copy']};
const values={};
try{
 if(!known[mode]||args.length%2)throw Error('USAGE');
 for(let i=0;i<args.length;i+=2){if(!known[mode].includes(args[i])||values[args[i]]!==undefined||!args[i+1]||args[i+1].startsWith('--'))throw Error('USAGE');values[args[i]]=args[i+1];}
 let result;
 if(mode==='create'){if(!values['--source']||!values['--awos']||!values['--output'])throw Error('USAGE');result=await createAwosCopy({config:loadCopySource(values['--source'],values['--awos']),repo:values['--awos'],output:values['--output']});}
 if(mode==='restore'){if(!values['--copy']||!values['--awos'])throw Error('USAGE');result=await restoreAwosCopy({path:values['--copy'],repo:values['--awos'],port:values['--port']?Number(values['--port']):4390});}
 if(mode==='inspect'){if(!values['--copy'])throw Error('USAGE');result=inspectAwosCopy(values['--copy']);}
 console.log(JSON.stringify(result,null,2));
}catch(e){console.error(/^(AWOS_[A-Z_]+|USAGE)$/.test(e.message)?e.message:'AWOS_COPY_NOT_CONFIRMED');process.exitCode=1;}
