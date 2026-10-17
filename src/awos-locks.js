// Cooperative cross-process exclusion for the experimental pair. SQLite releases
// a reserved lock after SIGKILL; no stale PID file is removed or trusted.
import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync,chmodSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';import {tmpdir} from 'node:os';
export function acquireAwosLocks(config){
 const held=[];
 try{
  const dirs=[config.dataDir,config.runtimeDir].map(p=>{const real=realpathSync(p),r=relative(realpathSync(tmpdir()),real);if(!r||r.startsWith('..')||isAbsolute(r)||lstatSync(p).isSymbolicLink())throw Error('AWOS_COPY_TEMP_REQUIRED');return real;}).sort();
  if(dirs[0]===dirs[1])throw Error('AWOS_SEPARATE_DIRS_REQUIRED');
  for(const dir of dirs){
   const path=join(dir,'.pyme1-awos-exclusive.db');
   try{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('AWOS_COPY_LOCK_INVALID');}catch(e){if(e.code!=='ENOENT')throw e;}
   const db=new DatabaseSync(path);held.push(db);chmodSync(path,0o600);
   db.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS guard (id INTEGER PRIMARY KEY); BEGIN IMMEDIATE');
  }
  let closed=false;return ()=>{if(closed)return;closed=true;for(const db of held.reverse())db.close();};
 }catch{for(const db of held.reverse())try{db.close();}catch{}throw Error('AWOS_PAIR_IN_USE_OR_LOCK_INVALID');}
}
