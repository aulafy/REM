import {fileURLToPath} from 'node:url';
import {runAwosFolderDialog} from './awos-copy-picker.js';
export async function serveCopyPicker({channel=process,dialog=runAwosFolderDialog}={}){
 const controller=new AbortController(),lost=()=>controller.abort();channel.once('disconnect',lost);
 if(!channel.connected)controller.abort();
 try{
  const path=await dialog({signal:controller.signal});if(channel.connected)await new Promise(ok=>channel.send({path},ok));
 }catch(e){if(channel.connected)await new Promise(ok=>channel.send({error:e.message==='AWOS_COPY_SELECTION_CANCELLED'?e.message:'AWOS_COPY_PICKER_UNAVAILABLE'},ok));}
 finally{channel.removeListener('disconnect',lost);if(channel.connected)channel.disconnect();}
}
// Importable for tests without launching macOS dialogs.
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await serveCopyPicker();
