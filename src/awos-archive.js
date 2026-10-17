// Offline, synthetic-only pair snapshots. No replacement of an existing installation.
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,readdirSync,lstatSync,realpathSync,chmodSync,openSync,closeSync,fsyncSync,renameSync,rmSync,existsSync} from 'node:fs';
import {join,relative,dirname,isAbsolute} from 'node:path';import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createConnection} from 'node:net';
import {fileURLToPath} from 'node:url';import {experimentalConfig} from './awos-guard.js';import {acquireAwosLocks} from './awos-locks.js';
const run=promisify(execFile),here=dirname(fileURLToPath(import.meta.url));
export const COPY_FILES=['data/pyme1.db','runtime/runtime.db','runtime/runtime.db.capsules.db','runtime/runtime.db.fake-email.db'];
const LIMIT=256*1024*1024,hash=b=>createHash('sha256').update(b).digest('hex'),keys=o=>Object.keys(o??{}).sort().join(',');
const regular=(p,max=LIMIT)=>{const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size<1||s.size>max)throw Error('AWOS_COPY_FILE_INVALID');return s;};
const directory=p=>{const r=realpathSync(p);if(lstatSync(p).isSymbolicLink()||!lstatSync(p).isDirectory())throw Error('AWOS_COPY_DIRECTORY_INVALID');return r;};
function fsync(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function privateWrite(path,value){writeFileSync(path,value,{flag:'wx',mode:0o600});fsync(path);}
function inside(root,path){const r=relative(root,path);return r===''||!r.startsWith('..')&&!isAbsolute(r);}
function configuration(c,repo){return experimentalConfig({PYME1_AWOS_EXPERIMENTAL:'1',PYME1_DATA_DIR:c.dataDir,PYME1_AWOS_DIR:c.runtimeDir,PYME1_AWOS_REPO:repo,PYME1_PORT:String(c.port),PYME1_AWOS_PLANNER:c.planner??'synthetic',PYME1_SECRETS:'memory'});}
export function loadCopySource(root,repo){
 const base=directory(root),r=relative(realpathSync(tmpdir()),base);if(!r||r.startsWith('..')||isAbsolute(r))throw Error('AWOS_COPY_TEMP_REQUIRED');
 const file=join(base,'qa-config.json');regular(file,8192);const c=JSON.parse(readFileSync(file,'utf8'));
 if(keys(c)!=='data,planner,port,root,runtime'||realpathSync(c.root)!==base||realpathSync(c.data)!==join(base,'data')||realpathSync(c.runtime)!==join(base,'runtime'))throw Error('AWOS_COPY_CONFIG_INVALID');
 return configuration({dataDir:c.data,runtimeDir:c.runtime,port:c.port,planner:c.planner},repo);
}
async function assertOffline(c){
 // Also fences older experimental hosts that predate the cooperative SQLite lock.
 const lock=join(c.runtimeDir,'runtime.lock');if(existsSync(lock)){
  regular(lock,64);const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('AWOS_COPY_PROCESS_INVALID');
  try{process.kill(pid,0);throw Error('AWOS_COPY_RUNTIME_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;}
 }
 await new Promise((ok,bad)=>{const socket=createConnection({host:'127.0.0.1',port:c.port});socket.setTimeout(500);socket.once('connect',()=>{socket.destroy();bad(Error('AWOS_COPY_SERVER_RUNNING'));});socket.once('error',e=>{socket.destroy();e.code==='ECONNREFUSED'?ok():bad(Error('AWOS_COPY_OFFLINE_UNCONFIRMED'));});socket.once('timeout',()=>{socket.destroy();bad(Error('AWOS_COPY_OFFLINE_UNCONFIRMED'));});});
}
function integrity(path){regular(path);const bytes=readFileSync(path);if(bytes.length<100||bytes.subarray(0,16).toString()!=='SQLite format 3\0'||bytes[18]!==1||bytes[19]!==1)throw Error('AWOS_COPY_SQLITE_FORMAT_INVALID');const db=new DatabaseSync(path,{readOnly:true});try{const r=db.prepare('PRAGMA integrity_check').all();if(r.length!==1||Object.values(r[0])[0]!=='ok')throw Error('AWOS_COPY_SQLITE_INVALID');}finally{db.close();}}
function sealSqliteFiles(stage){
 // Close the verifier first, then checkpoint only the private copies. A read-only
 // opener must never need WAL/SHM files beside a published, immutable bundle.
 for(const name of COPY_FILES){const db=new DatabaseSync(join(stage,name));try{const checkpoint=db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();if(checkpoint.busy!==0||db.prepare('PRAGMA journal_mode=DELETE').get().journal_mode!=='delete')throw Error('AWOS_COPY_CHECKPOINT_FAILED');}finally{db.close();}}
}
async function validateRuntime(stage,repo){
 const script=join(here,'../scripts/verify-awos-copy.mjs');
 try{const r=await run(process.execPath,['--disable-warning=ExperimentalWarning','--import','tsx',script,stage,repo],{cwd:repo,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},timeout:45_000,maxBuffer:1_000_000});const value=JSON.parse(r.stdout);if(value?.format!=='pyme1-awos-verified-v1')throw Error();return value;}
 catch{throw Error('AWOS_COPY_REPLAY_OR_PAIR_INVALID');}
}
function exactLayout(root){
 if(readdirSync(root).sort().join(',')!=='data,manifest.json,runtime')throw Error('AWOS_COPY_LAYOUT_INVALID');
 if(readdirSync(directory(join(root,'data'))).sort().join(',')!=='pyme1.db'||readdirSync(directory(join(root,'runtime'))).sort().join(',')!=='runtime.db,runtime.db.capsules.db,runtime.db.fake-email.db')throw Error('AWOS_COPY_LAYOUT_INVALID');
}
export function inspectAwosCopy(path,{withFingerprint=false}={}){
 const root=directory(path);exactLayout(root);regular(join(root,'manifest.json'),50_000);
 const rawManifest=readFileSync(join(root,'manifest.json'),'utf8'),m=JSON.parse(rawManifest);
 if(keys(m)!=='createdAt,files,format,id,nodeVersion,owner,tenant'||m.format!=='pyme1-awos-copy-v1'||m.tenant!=='pyme1-local'||m.owner!=='pyme1-owner'||typeof m.id!=='string'||!/^copy-[a-f0-9-]{36}$/.test(m.id)||typeof m.createdAt!=='string'||!Number.isFinite(Date.parse(m.createdAt))||typeof m.nodeVersion!=='string'||!Array.isArray(m.files)||m.files.length!==COPY_FILES.length)throw Error('AWOS_COPY_MANIFEST_INVALID');
 for(const [i,name] of COPY_FILES.entries()){
  const f=m.files[i];if(keys(f)!=='bytes,path,sha256'||f.path!==name||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>LIMIT||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('AWOS_COPY_MANIFEST_INVALID');
  const file=join(root,name);if(regular(file).size!==f.bytes||hash(readFileSync(file))!==f.sha256)throw Error('AWOS_COPY_HASH_MISMATCH');integrity(file);
 }
 return withFingerprint?{manifest:m,manifestHash:hash(rawManifest)}:m;
}
async function capturePair(c,out,copyId,hooks={}){
 let stage;
 try{stage=mkdtempSync(join(out,'.pyme1-awos-copy-'));chmodSync(stage,0o700);
  mkdirSync(join(stage,'data'),{mode:0o700});mkdirSync(join(stage,'runtime'),{mode:0o700});
  for(const name of COPY_FILES){
   const source=join(name.startsWith('data/')?c.dataDir:c.runtimeDir,name.split('/')[1]);regular(source);
   const db=new DatabaseSync(source,{readOnly:true});try{db.exec('VACUUM INTO '+"'"+join(stage,name).replaceAll("'","''")+"'");}finally{db.close();}
   chmodSync(join(stage,name),0o600);hooks.afterFile?.(name);
  }
  const verified=await validateRuntime(stage,c.repo);sealSqliteFiles(stage);
  const id=copyId,manifest={format:'pyme1-awos-copy-v1',id,createdAt:new Date().toISOString(),tenant:'pyme1-local',owner:'pyme1-owner',nodeVersion:process.versions.node,files:COPY_FILES.map(path=>({path,bytes:regular(join(stage,path)).size,sha256:hash(readFileSync(join(stage,path)))}))};
  privateWrite(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');inspectAwosCopy(stage);
  for(const name of COPY_FILES)fsync(join(stage,name));for(const name of ['data','runtime',''])fsync(join(stage,name));
  const target=join(out,'pyme1-awos-'+id);hooks.beforePublish?.({stage,target,manifest,verified});if(existsSync(target))throw Error('AWOS_COPY_TARGET_EXISTS');renameSync(stage,target);stage=null;fsync(out);hooks.afterPublish?.(target);
  return {path:target,manifest,verified};
 }finally{if(stage)rmSync(stage,{recursive:true,force:true});}
}
function outputFor(c,output){const out=directory(output);if([c.dataDir,c.runtimeDir].some(d=>inside(d,out)||inside(out,d)))throw Error('AWOS_COPY_OUTPUT_OVERLAP');return out;}
export async function createAwosCopy({config,repo,output,hooks={}}){
 const c=configuration(config,repo),out=outputFor(c,output),release=acquireAwosLocks(c);
 try{await assertOffline(c);return await capturePair(c,out,'copy-'+randomUUID(),hooks);}finally{release();}
}
// Trusted supervisor boundary, never selected by an HTTP flag. The callback
// drains every admitted business request and closes AWOS while retaining both
// directory locks. The listening UI is deliberately kept alive for job status.
export function managedAwosCopyWriter({config,repo,output,withPaused}){
 const c=configuration(config,repo),out=outputFor(c,output);
 if(typeof withPaused!=='function')throw Error('AWOS_COPY_PAUSE_REQUIRED');
 return {capture:(copyId,hooks={})=>{if(directory(output)!==out)throw Error('AWOS_COPY_DIRECTORY_CHANGED');if(typeof copyId!=='string'||!/^copy-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(copyId))throw Error('AWOS_COPY_ID_INVALID');return withPaused(async()=>{
  const lock=join(c.runtimeDir,'runtime.lock');if(existsSync(lock)){regular(lock,64);const pid=Number(readFileSync(lock,'utf8'));if(!Number.isSafeInteger(pid)||pid<1)throw Error('AWOS_COPY_PROCESS_INVALID');try{process.kill(pid,0);throw Error('AWOS_COPY_RUNTIME_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;}}
  return capturePair(c,out,copyId,hooks);
 });}};
}
export async function restoreAwosCopy({path,repo,port=4390,restoreId=randomUUID(),requestScope=hash('offline:'+randomUUID()),expectedManifestHash,hooks={}}){
 // Always a fresh temporary root. No caller-controlled destination or overwrites.
 if(typeof requestScope!=='string'||!/^[a-f0-9]{64}$/.test(requestScope))throw Error('AWOS_COPY_SCOPE_INVALID');
 if(typeof restoreId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(restoreId))throw Error('AWOS_COPY_ID_INVALID');
 if(!Number.isInteger(port)||port<1024||port>65535||port===4317)throw Error('AWOS_QA_PORT_REQUIRED');
 const checked=inspectAwosCopy(path,{withFingerprint:true}),manifest=checked.manifest;if(expectedManifestHash!==undefined&&expectedManifestHash!==checked.manifestHash)throw Error('AWOS_COPY_CHANGED');let stage=mkdtempSync(join(tmpdir(),'.pyme1-awos-restore-'));
 try{
  chmodSync(stage,0o700);mkdirSync(join(stage,'data'),{mode:0o700});mkdirSync(join(stage,'runtime'),{mode:0o700});
  for(const name of COPY_FILES){const source=join(path,name),bytes=readFileSync(source),f=manifest.files.find(f=>f.path===name);if(hash(bytes)!==f.sha256)throw Error('AWOS_COPY_CHANGED');privateWrite(join(stage,name),bytes);hooks.afterFile?.(name);}
  const verified=await validateRuntime(stage,directory(repo));sealSqliteFiles(stage);
  // Markers are created only after successful replay and cross-database checks.
  for(const name of ['data','runtime'])privateWrite(join(stage,name,'.pyme1-awos-experiment'),'synthetic-v1\n');
  const c=configuration({dataDir:join(stage,'data'),runtimeDir:join(stage,'runtime'),port,planner:'synthetic'},repo);
  const target=join(realpathSync(tmpdir()),'pyme1-awos-restored-'+restoreId);
  const config={root:target,data:join(target,'data'),runtime:join(target,'runtime'),planner:c.planner,port:c.port};
  privateWrite(join(stage,'qa-config.json'),JSON.stringify(config,null,2)+'\n');
  privateWrite(join(stage,'restore-receipt.json'),JSON.stringify({format:'pyme1-awos-restore-v1',copyId:manifest.id,restoreId,requestScope,manifestHash:checked.manifestHash,at:new Date().toISOString(),verified},null,2)+'\n');
  for(const name of COPY_FILES)fsync(join(stage,name));for(const name of ['data','runtime',''])fsync(join(stage,name));hooks.beforePublish?.({stage,target});
  if(existsSync(target))throw Error('AWOS_COPY_TARGET_EXISTS');renameSync(stage,target);stage=null;fsync(realpathSync(tmpdir()));hooks.afterPublish?.(target);
  return {root:target,config,copyId:manifest.id,verified};
 }finally{if(stage)rmSync(stage,{recursive:true,force:true});}
}

// Import a user-selected immutable bundle into the private catalog. Source files
// are never opened for writing. Validate the copied bytes again before replay.
export async function importAwosCopy({path,repo,output,copyId,expectedManifestHash,hooks={}}){
 if(typeof copyId!=='string'||!/^copy-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(copyId))throw Error('AWOS_COPY_ID_INVALID');
 const checked=inspectAwosCopy(path,{withFingerprint:true});if(checked.manifestHash!==expectedManifestHash)throw Error('AWOS_COPY_CHANGED');
 const out=directory(output),source=directory(path);if(inside(source,out)||inside(out,source))throw Error('AWOS_COPY_OUTPUT_OVERLAP');
 let stage=mkdtempSync(join(out,'.pyme1-awos-import-'));
 try{
  chmodSync(stage,0o700);for(const name of ['data','runtime'])mkdirSync(join(stage,name),{mode:0o700});
  for(const member of checked.manifest.files){const bytes=readFileSync(join(source,member.path));if(bytes.length!==member.bytes||hash(bytes)!==member.sha256)throw Error('AWOS_COPY_CHANGED');privateWrite(join(stage,member.path),bytes);hooks.afterFile?.(member.path);}
  privateWrite(join(stage,'manifest.json'),JSON.stringify(checked.manifest,null,2)+'\n');inspectAwosCopy(stage);
  const verified=await validateRuntime(stage,directory(repo));sealSqliteFiles(stage);
  const manifest={...checked.manifest,id:copyId,files:COPY_FILES.map(path=>({path,bytes:regular(join(stage,path)).size,sha256:hash(readFileSync(join(stage,path)))}))};
  rmSync(join(stage,'manifest.json'));privateWrite(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');inspectAwosCopy(stage);
  for(const name of COPY_FILES)fsync(join(stage,name));for(const name of ['data','runtime',''])fsync(join(stage,name));
  const target=join(out,'pyme1-awos-'+copyId);hooks.beforePublish?.({stage,target,manifest,verified});if(existsSync(target))throw Error('AWOS_COPY_TARGET_EXISTS');renameSync(stage,target);stage=null;fsync(out);hooks.afterPublish?.(target);
  return {path:target,manifest,verified};
 }finally{if(stage)rmSync(stage,{recursive:true,force:true});}
}
