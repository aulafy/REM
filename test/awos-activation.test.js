import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {experimentalConfig} from '../src/awos-guard.js';
test('desactivado por defecto no inspecciona directorios ni configuración',()=>{assert.equal(experimentalConfig({PYME1_DATA_DIR:'/does-not-exist'}),null);});
test('activación solo temporal, secrets memory, puerto aislado; reinicio conserva marcadores',()=>{
 const data=mkdtempSync(join(tmpdir(),'pyme1-data-')),runtime=mkdtempSync(join(tmpdir(),'pyme1-runtime-'));const env={PYME1_AWOS_EXPERIMENTAL:'1',PYME1_DATA_DIR:data,PYME1_AWOS_DIR:runtime,PYME1_SECRETS:'memory',PYME1_PORT:'4390',PYME1_AWOS_REPO:data};
 try{assert.equal(experimentalConfig(env).port,4390);assert.equal(experimentalConfig(env).port,4390);
  for(const override of [{PYME1_PORT:'4317'},{PYME1_SECRETS:'keychain'},{PYMES_GMAIL_ENABLED:'0'},{PYMES_API_WORKER_TOKEN:'x'},{PYMES_MESSAGE_GATEWAY_URL:'http://example.test'},{PYME1_AWOS_DIR:data}])assert.throws(()=>experimentalConfig({...env,...override}));
  symlinkSync(runtime,join(data,'alias'));assert.throws(()=>experimentalConfig({...env,PYME1_AWOS_DIR:join(data,'alias')}));
 }finally{rmSync(data,{recursive:true,force:true});rmSync(runtime,{recursive:true,force:true});}
});
