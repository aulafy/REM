// Uso: node scripts/eval-redactor.js [repo congelado] [fase] [resultados].
// Cinco repeticiones completas, solo transporte Ollama local; resultados fuera de Git/DMG.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base=resolve(process.argv[2] || new URL('..',import.meta.url).pathname),phase=process.argv[3]||'final';
const out=resolve(process.argv[4] || join(base,'eval/results/redactor-matrix'));
const clientPhone=JSON.parse(readFileSync(join(base,'eval/casos.json'))).clients;
import {augmentExamen3} from './eval-redactor-checks.js';
mkdirSync(out,{recursive:true});
const {evaluate,summarize}=await import(pathToFileURL(join(base,'scripts/eval.js')));
const {dateReferences,fold}=await import(pathToFileURL(join(base,'src/dates.js')));
const {allowedNumbers,numbers}=await import(pathToFileURL(join(base,'src/numbers.js')));
const seed=20261010,nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=String(input);
 if(!url.startsWith('http://127.0.0.1:11434/'))throw new Error('Evaluación limitada a Ollama local');
 if(url.endsWith('/api/chat')&&options.body){const body=JSON.parse(options.body);body.options={...body.options,seed};options={...options,body:JSON.stringify(body)};}
 return nativeFetch(input,options);
};
const matrix=[];
for(const battery of ['examen3','examen','examen2','casos'])for(const rules of [true,false])matrix.push({model:'qwen3.5:9b-mlx',battery,rules});
for(const rules of [true,false])matrix.push({model:'llama3.2:3b',battery:'examen3',rules});
for(const item of matrix){
 const tag=`${phase}-${item.model.replace(/[^\w.-]/g,'_')}-${item.battery}-${item.rules?'reglas':'sin-reglas'}`;
 const rows=[],runs=[];
 for(let rep=1;rep<=5;rep++){
  const file=join(out,`${tag}-r${rep}.json`);let result;
  if(existsSync(file))result=JSON.parse(readFileSync(file));
  else{
   console.log(`INICIO ${tag} repetición ${rep}/5`);
   result=await evaluate({model:item.model,casesFile:`eval/${item.battery}.json`,rules:item.rules,repetitions:1,label:`${tag}-r${rep}`,resultsDir:join(base,'eval/results/redactor-raw')});
   result.rows=result.rows.map(row=>augmentExamen3(row,clientPhone)).map(r=>({...r,repetition:rep}));result.summary=summarize(result.rows);
   result.seed={requested:seed,mechanism:'Inyección de options.seed en fetch del harness, sin cambiar el adaptador del producto',honored:'No confirmado: aceptar el parámetro no prueba que el runner MLX lo respete'};
   result.harnessSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
   writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  }
  rows.push(...result.rows);runs.push({...result,rows:undefined});
  writeFileSync(join(out,'PROGRESO.json'),JSON.stringify({phase,tag,repetitionsCompleted:rep,of:5,updatedAt:new Date().toISOString()},null,2)+'\n');
 }
 const summary=summarize(rows);
 const groups={total:rows,...Object.fromEntries([...new Set(rows.map(r=>r.type))].map(t=>[t,rows.filter(r=>r.type===t)]))};
 for(const [key,rs]of Object.entries(groups)){
  const group=key==='total'?summary.total:summary.types[key],lat=rs.map(r=>r.ms).sort((a,b)=>a-b);
  const scores=Array.from({length:5},(_,i)=>{const xs=rs.filter(r=>r.repetition===i+1);return 100*xs.filter(r=>r.passed).length/xs.length;});
  Object.assign(group,{maxPercent:Math.max(...scores),variationRange:Math.max(...scores)-Math.min(...scores),meanMs:Math.round(lat.reduce((a,b)=>a+b,0)/lat.length),p90Ms:lat[Math.ceil(lat.length*.9)-1],dateWarnings:rs.flatMap(r=>r.result?.proposals||[]).filter(p=>p.payload.avisosFecha?.length).length});
 }
 writeFileSync(join(out,`${tag}-5-repeticiones.json`),JSON.stringify({...item,phase,repetitions:5,seed:seed,runs,summary,rows},null,2)+'\n',{mode:0o600});
 console.log(`COMPLETO ${tag} ${summary.total.passed}/${summary.total.cases}`);
}
writeFileSync(join(out,`${phase}-COMPLETO.json`),JSON.stringify({phase,completedAt:new Date().toISOString(),runs:matrix.length,repetitions:5})+'\n');
