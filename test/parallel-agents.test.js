import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validatePlan, packetFor, workerCommand, packetPermissions, limitedMap, resultStatus, run } from '../scripts/parallel-agents.mjs';

const base='a'.repeat(40);
const task=()=>({id:'uno',engine:'opencode',model:'opencode/mimo-v2.6-flash-free',mode:'review',goal:'Revisa el contrato.',files:['src/a.js'],writePaths:[]});
const plan=()=>({version:1,base,tasks:[task()]});
test('paralelo: exige modelos free explícitos y superficies de escritura disjuntas',()=>{
 assert.equal(validatePlan(plan()).base,base);
 for(const model of ['anthropic/paid','opencode/pago','--auto'])assert.throws(()=>validatePlan({...plan(),tasks:[{...task(),model}]}));
 const writer={...task(),mode:'patch',writePaths:['src/a.js']};
 assert.throws(()=>validatePlan({...plan(),tasks:[writer,{...writer,id:'dos'}]}),/WRITE_SCOPE_CONFLICT/);
 assert.throws(()=>validatePlan({...plan(),tasks:[{...writer,mode:'review'}]}),/WRITE_SCOPE_INVALID/);
 assert.throws(()=>validatePlan({...plan(),tasks:[{...task(),files:['src/../.env']}] }));
 assert.throws(()=>validatePlan({...plan(),tasks:[{...task(),files:['src/client-secret.json']}]}));
});
test('paralelo: agente nativo con lectura exacta; nunca auto/bypass/ejecución de shell',()=>{
 const o=workerCommand(task(),'/tmp/source packet.md');
 assert.equal(o.bin,'opencode');assert.ok(o.args.includes('--standalone'));assert.ok(!o.args.includes('--auto'));
 assert.equal(o.args[o.args.indexOf('--agent')+1],'build');
 assert.deepEqual(packetPermissions(['/tmp/work/src/a.js']),[{action:'*',resource:'*',effect:'deny'},{action:'read',resource:'/tmp/work/src/a.js',effect:'allow'}]);
 assert.throws(()=>packetPermissions(['/tmp/*']),/READ_SCOPE_INVALID/);
 assert.throws(()=>packetPermissions(['../a.js']),/READ_SCOPE_INVALID/);
 const g=workerCommand({...task(),engine:'grok',model:'grok-4.7'},'/tmp/source packet.md');
 assert.equal(g.args[g.args.indexOf('--tools')+1],'');assert.ok(g.args.includes('--no-subagents'));assert.ok(g.args.includes('--disable-web-search'));
});
test('paralelo: máximo dos trabajadores simultáneos y resultados en orden',async()=>{
 let active=0,peak=0;
 const out=await limitedMap([0,1,2,3],2,async i=>{active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,10));active--;return i*2;});
 assert.equal(peak,2);assert.deepEqual(out,[0,2,4,6]);
 await assert.rejects(limitedMap([],0,()=>{}),/CONCURRENCY_INVALID/);
});
test('paralelo: errores API, vacío, timeout y CLI ausente nunca cuentan como éxito',()=>{
 assert.equal(resultStatus({code:0,stdout:'{"type":"error","error":{"status":403}}\n'}),'failed');
 assert.equal(resultStatus({code:0,stdout:''}),'failed');
 assert.equal(resultStatus({code:1,stdout:'balance exhausted'}),'failed');
 assert.equal(resultStatus({code:0,stdout:'text',timedOut:true}),'timeout');
 assert.equal(resultStatus({code:null,spawnError:'ENOENT'}),'unavailable');
 assert.equal(resultStatus({code:0,stdout:'{"type":"text","text":"ok"}\n'}),'returned');
 assert.equal(resultStatus({code:0,stdout:'{"type":"step_start"}\n'}),'failed');
 assert.equal(resultStatus({code:0,stdout:'{"type":"text","part":{"text":"ok"}}\n'}),'returned');
});

async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'rem-agents-test-')));
 const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(['init','-q']);await mkdir(join(root,'src'));await writeFile(join(root,'src/a.js'),'export const demo = true;\n');
 git(['add','src/a.js']);git(['-c','user.name=REM Test','-c','user.email=qa@example.test','commit','-qm','Fixture sintético']);
 t.after(async()=>{const lines=git(['worktree','list','--porcelain']).split('\n').filter(s=>s.startsWith('worktree ')).map(s=>s.slice(9));for(const path of lines)if(path!==root)git(['worktree','remove',path]);await rm(root,{recursive:true,force:true});});
 return {root,git,base:git(['rev-parse','HEAD'])};
}
test('paralelo: fuentes congeladas con hashes; rechaza secretos y ficheros no versionados',async t=>{
 const f=await fixture(t),p={...plan(),base:f.base};
 const packet=packetFor(f.root,p,p.tasks[0]);assert.match(packet.prompt,/1: export const demo = true;/);assert.match(packet.manifest[0].sha256,/^[a-f0-9]{64}$/);
 await writeFile(join(f.root,'src/a.js'),'cambio local');assert.equal(packetFor(f.root,p,p.tasks[0]).manifest[0].sha256,packet.manifest[0].sha256);
 assert.throws(()=>packetFor(f.root,p,{...task(),files:['src/missing.js']}),/SOURCE_NOT_REGULAR_TRACKED_FILE/);
 await writeFile(join(f.root,'src/a.js'),'const key = "GOCSPX-'+ 'a'.repeat(30)+'";');f.git(['add','.']);f.git(['-c','user.name=REM Test','-c','user.email=qa@example.test','commit','-qm','Fixture rechazado']);
 assert.throws(()=>packetFor(f.root,{...p,base:f.git(['rev-parse','HEAD'])},task()),/SOURCE_REFUSED/);
});
test('paralelo: dry-run aislado no llama modelos, no integra y rechaza SHA viejo o checkout sucio',async t=>{
 const f=await fixture(t),dev=await mkdtemp(join(tmpdir(),'rem-agents-output-'));t.after(()=>rm(dev,{recursive:true,force:true}));
 const p={...plan(),base:f.base};
 await assert.rejects(run({...p,base},{root:f.root,dryRun:true,dev}),/BASE_CHANGED/);
 const result=await run(p,{root:f.root,dryRun:true,dev});
 assert.equal(result.results[0].status,'not_executed');assert.equal(result.integrated,false);assert.equal(result.testsRunByWorkers,false);assert.equal(result.results[0].workspaceUnchanged,true);assert.equal(f.git(['status','--porcelain']),'');
 await writeFile(join(f.root,'src/a.js'),'dirty');await assert.rejects(run(p,{root:f.root,dryRun:true,dev}),/CHECKOUT_DIRTY/);
});
