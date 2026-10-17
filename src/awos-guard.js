import {realpathSync,lstatSync,readdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
export function experimentalConfig(env=process.env){
 if(env.PYME1_AWOS_EXPERIMENTAL!=='1')return null;
 const port=Number(env.PYME1_PORT);
 if(!Number.isInteger(port)||port<1024||port>65535||port===4317)throw Error('AWOS_QA_PORT_REQUIRED');
 if(env.PYME1_SECRETS!=='memory')throw Error('AWOS_MEMORY_SECRETS_REQUIRED');
 for(const k of Object.keys(env))if(/^PYMES_(GMAIL_|TELEGRAM_|OPENCLAW_|WHATSAPP_|.*_GATEWAY_|API_WORKER_TOKEN)/.test(k))throw Error('AWOS_CONNECTOR_ENV_DENIED');
 const dirs=[env.PYME1_DATA_DIR,env.PYME1_AWOS_DIR].map(p=>{
  if(!p)throw Error('AWOS_TEMP_REQUIRED');
  const real=realpathSync(p),r=relative(realpathSync(tmpdir()),real);
  if(!r||r.startsWith('..')||isAbsolute(r)||lstatSync(p).isSymbolicLink()||realpathSync(resolve(p,'..'))!==resolve(real,'..'))throw Error('AWOS_TEMP_REQUIRED');
  return real;
 });
 if(dirs[0]===dirs[1]||dirs.some((d,i)=>!relative(d,dirs[1-i]).startsWith('..')))throw Error('AWOS_SEPARATE_DIRS_REQUIRED');
 // A private marker permits restart on these directories, never adoption of existing app data.
 for(const d of dirs){const marker=join(d,'.pyme1-awos-experiment');
  if(readdirSync(d).length===0)writeFileSync(marker,'synthetic-v1\n',{flag:'wx',mode:0o600});
  if(lstatSync(marker).isSymbolicLink()||readFileSync(marker,'utf8')!=='synthetic-v1\n')throw Error('AWOS_TEMP_MARKER_REQUIRED');
 }
 const planner=env.PYME1_AWOS_PLANNER??'local';if(!['local','synthetic'].includes(planner))throw Error('AWOS_PLANNER_INVALID');
 if(!env.PYME1_AWOS_REPO)throw Error('AWOS_REPO_REQUIRED');
 return {dataDir:dirs[0],runtimeDir:dirs[1],repo:realpathSync(env.PYME1_AWOS_REPO),port,planner};
}
