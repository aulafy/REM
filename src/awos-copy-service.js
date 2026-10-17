import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,lstatSync,realpathSync,readFileSync,existsSync} from 'node:fs';import {dirname,join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {inspectAwosCopy,managedAwosCopyWriter,restoreAwosCopy,loadCopySource,importAwosCopy} from './awos-archive.js';import {startRestoredApp,probeRestoredApp} from './awos-restored-app.js';import {AwosError} from './awos-client.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v),hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const regular=p=>{const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw new AwosError('AWOS_COPY_FILE_INVALID');};
export function createAwosCopyService({config,withPaused,resumeRuntime,runtimeReady,chooseDirectory=async()=>{throw Error('AWOS_COPY_PICKER_UNAVAILABLE');},reveal=async()=>{},launch=startRestoredApp,probe=probeRestoredApp,hooks={}}){
 const root=dirname(config.dataDir);if(root!==dirname(config.runtimeDir)||realpathSync(root)===realpathSync(tmpdir()))throw Error('AWOS_COPY_GROUP_REQUIRED');
 const folder=join(root,'copias-conjuntas');mkdirSync(folder,{recursive:true,mode:0o700});if(lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory())throw Error('AWOS_COPY_DIRECTORY_INVALID');chmodSync(folder,0o700);
 const file=join(root,'awos-copy-control.db');if(existsSync(file))regular(file);const db=new DatabaseSync(file);chmodSync(file,0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS binding (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,input TEXT NOT NULL,identity TEXT NOT NULL,state TEXT NOT NULL,phase TEXT NOT NULL,result TEXT,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS selections (job TEXT PRIMARY KEY,path TEXT NOT NULL,manifestHash TEXT NOT NULL)');
 const identity=hash([config.dataDir,config.runtimeDir]),bound=db.prepare('SELECT id FROM binding').all();if(bound.length&& (bound.length!==1||bound[0].id!==identity)){db.close();throw Error('AWOS_COPY_CONTROL_SCOPE_INVALID');}if(!bound.length)db.prepare('INSERT INTO binding VALUES(?)').run(identity);
 db.prepare("UPDATE jobs SET state='interrupted',phase='interrupted' WHERE state='running'").run();
 let working=null,closing=false;
 const writer=managedAwosCopyWriter({config,repo:config.repo,output:folder,withPaused});
 const row=id=>{const r=db.prepare('SELECT * FROM jobs WHERE id=?').get(id);return r?{...r,input:JSON.parse(r.input),result:r.result?JSON.parse(r.result):null}:null;};
 const rows=()=>db.prepare('SELECT id FROM jobs ORDER BY created DESC,id DESC LIMIT 100').all().map(r=>row(r.id));
 const save=(id,state,phase,result,error=null)=>{db.prepare('UPDATE jobs SET state=?,phase=?,result=?,error=?,updated=? WHERE id=?').run(state,phase,result?JSON.stringify(result):null,error,Date.now(),id);hooks.afterPersist?.(phase,row(id));};
 const path=id=>join(folder,'pyme1-awos-copy-'+id);
 function descriptor(r){const p=path(r.id),checked=inspectAwosCopy(p,{withFingerprint:true}),m=checked.manifest,fingerprint=checked.manifestHash;if(m.id!=='copy-'+r.id||r.result?.manifestHash!==fingerprint)throw new AwosError('AWOS_COPY_CHANGED');return {...r.result,copyId:r.id,createdAt:m.createdAt,bytes:m.files.reduce((n,f)=>n+f.bytes,0)};}
 function restored(r){const target=join(realpathSync(tmpdir()),'pyme1-awos-restored-'+r.id);const c=loadCopySource(target,config.repo);if(realpathSync(target)!==realpathSync(dirname(c.dataDir)))throw Error('AWOS_COPY_RESTORE_SCOPE_INVALID');const receiptFile=join(target,'restore-receipt.json');regular(receiptFile);const receipt=JSON.parse(readFileSync(receiptFile,'utf8'));if(receipt.format!=='pyme1-awos-restore-v1'||receipt.copyId!=='copy-'+r.input.copyId||receipt.restoreId!==r.id||receipt.requestScope!==identity||receipt.manifestHash!==r.input.manifestHash)throw Error('AWOS_COPY_RESTORE_SCOPE_INVALID');return {root:target,copyId:r.input.copyId,summary:receipt.verified};}
 const nonces=restoreId=>rows().filter(r=>r.kind==='open'&&r.input.restoreId===restoreId).map(r=>r.id);
 async function recover(r){
  if(r.state==='completed'){try{if(['create','import'].includes(r.kind))descriptor(r);if(r.kind==='restore')restored(r);if(r.kind==='open'){const target=row(r.input.restoreId),live=target?.result?.root?await probe(target.result.root,config.repo,nonces(target.id)):null;if(!live){save(r.id,'failed','closed',r.result,'AWOS_RESTORED_SESSION_CLOSED');return row(r.id);}if(JSON.stringify(live)!==JSON.stringify(r.result))save(r.id,'completed','recovered',live,r.error);}return row(r.id);}catch{save(r.id,'failed','missing',r.result,'AWOS_COPY_UNAVAILABLE');return row(r.id);}}
  try{
   let result;
   if(['create','import'].includes(r.kind)&&existsSync(path(r.id)))result=descriptor(r);
   if(r.kind==='restore'&&existsSync(join(realpathSync(tmpdir()),'pyme1-awos-restored-'+r.id)))result=restored(r);
   if(r.kind==='open'){const target=row(r.input.restoreId);if(target?.state==='completed')result=await probe(target.result.root,config.repo,nonces(target.id));}
   if(result)save(r.id,'completed','recovered',result,r.error);return row(r.id);
  }catch{save(r.id,'failed','invalid',r.result,'AWOS_COPY_RECOVERY_UNCONFIRMED');return row(r.id);}
 }
 function queue(r){
  if(closing)throw new AwosError('AWOS_COPY_CLOSING',503);if(working)throw new AwosError('AWOS_COPY_BUSY');
  save(r.id,'running','queued',r.result);working=(async()=>{
   try{
    let result;
    if(r.kind==='create'){
     save(r.id,'running','pausing',null);
     await writer.capture('copy-'+r.id,{beforePublish:({manifest,verified})=>save(r.id,'running','validated',{copyId:r.id,manifestHash:hash(JSON.stringify(manifest,null,2)+'\n'),summary:verified}),afterPublish:target=>hooks.afterPublish?.(target,row(r.id))});
     result=descriptor(row(r.id));
    }else if(r.kind==='import'){
     let selection=db.prepare('SELECT * FROM selections WHERE job=?').get(r.id);
     if(!selection){save(r.id,'running','selecting',null);const selected=await chooseDirectory();if(!selected)throw Error('AWOS_COPY_SELECTION_CANCELLED');const checked=inspectAwosCopy(selected,{withFingerprint:true});selection={path:realpathSync(selected),manifestHash:checked.manifestHash};db.prepare('INSERT INTO selections VALUES(?,?,?)').run(r.id,selection.path,selection.manifestHash);save(r.id,'running','selected',null);}
     save(r.id,'running','importing',null);
     await importAwosCopy({path:selection.path,repo:config.repo,output:folder,copyId:'copy-'+r.id,expectedManifestHash:selection.manifestHash,hooks:{beforePublish:({manifest,verified})=>save(r.id,'running','validated',{copyId:r.id,manifestHash:hash(JSON.stringify(manifest,null,2)+'\n'),summary:verified,sourceManifestHash:selection.manifestHash}),afterPublish:target=>hooks.afterPublish?.(target,row(r.id))}});
     result=descriptor(row(r.id));
    }else if(r.kind==='restore'){
     const selected=row(r.input.copyId),d=descriptor(selected);if(d.manifestHash!==r.input.manifestHash)throw Error('AWOS_COPY_CHANGED');save(r.id,'running','restoring',null);
     await restoreAwosCopy({path:path(selected.id),repo:config.repo,port:config.port,restoreId:r.id,requestScope:identity,expectedManifestHash:r.input.manifestHash});result=restored(r);hooks.afterRestore?.(result,row(r.id));
    }else if(r.kind==='open'){
     const target=await recover(row(r.input.restoreId));if(target?.state!=='completed')throw Error('AWOS_COPY_RESTORE_REQUIRED');save(r.id,'running','opening',null);result=await probe(target.result.root,config.repo,nonces(target.id))??await launch(target.result.root,config.repo,r.id);
    }else{save(r.id,'running','resuming',null);await resumeRuntime();result={runtimeReady:runtimeReady()};if(!result.runtimeReady)throw Error('AWOS_RESUME_FAILED');}
    save(r.id,'completed','completed',result);
   }catch(e){const code=/^AWOS_[A-Z0-9_]+$/.test(e.message)?e.message:'AWOS_COPY_NOT_CONFIRMED';save(r.id,'failed','failed',row(r.id).result,code);await recover(row(r.id));}
   finally{working=null;}
  })();return row(r.id);
 }
 async function request(kind,input){
  const fields={create:'requestId',import:'requestId',restore:'confirmation,copyId,manifestHash,requestId',open:'requestId,restoreId',resume:'requestId'};
  if(!input||Object.keys(input).sort().join(',')!==fields[kind]||!uuid(input.requestId)||kind==='restore'&&(!uuid(input.copyId)||!/^[a-f0-9]{64}$/.test(input.manifestHash)||input.confirmation!=='RESTAURAR')||kind==='open'&&!uuid(input.restoreId))throw new AwosError('AWOS_COPY_INPUT_INVALID',400);
  const digest=hash({kind,input}),old=row(input.requestId);if(old){if(old.identity!==digest)throw new AwosError('AWOS_COPY_REQUEST_CONFLICT');const confirmed=await recover(old);return {job:confirmed};}
  if(closing||working)throw new AwosError('AWOS_COPY_BUSY');
  if(kind==='restore'){const selected=row(input.copyId);if(!['create','import'].includes(selected?.kind)||selected.state!=='completed'||descriptor(selected).manifestHash!==input.manifestHash)throw new AwosError('AWOS_COPY_CHANGED');}
  if(kind==='open'){const selected=row(input.restoreId);if(selected?.kind!=='restore'||selected.state!=='completed')throw new AwosError('AWOS_COPY_RESTORE_REQUIRED');}
  const at=Date.now();db.prepare("INSERT INTO jobs VALUES(?,?,?,?, 'interrupted','recorded',NULL,NULL,?,?)").run(input.requestId,kind,JSON.stringify(input),digest,at,at);hooks.afterPersist?.('recorded',row(input.requestId));return {job:queue(row(input.requestId))};
 }
 return {request,async retry(id){if(!uuid(id)||!row(id))throw new AwosError('AWOS_COPY_JOB_NOT_FOUND',404);const r=await recover(row(id));return {job:['failed','interrupted'].includes(r.state)?queue(r):r};},async status(){
  if(!working)for(const r of rows().filter(r=>['interrupted','failed'].includes(r.state)||r.kind==='open'))await recover(r);
  const list=rows(),copies=[];for(const r of list.filter(r=>['create','import'].includes(r.kind)&&r.state==='completed'))try{copies.push(descriptor(r));}catch{copies.push({copyId:r.id,error:'AWOS_COPY_CHANGED'});}
  return {enabled:true,busy:!!working,runtimeReady:runtimeReady(),copies,jobs:list.map(r=>({id:r.id,kind:r.kind,state:r.state,phase:r.phase,result:r.result,error:r.error,created:r.created,updated:r.updated}))};
 },async reveal(copyId){const r=row(copyId);if(!uuid(copyId)||!['create','import'].includes(r?.kind)||r.state!=='completed')throw new AwosError('AWOS_COPY_JOB_NOT_FOUND',404);descriptor(r);await reveal(path(copyId));return {ok:true};},async close(){closing=true;await working;db.close();},settled:async()=>{await working;}};
}
