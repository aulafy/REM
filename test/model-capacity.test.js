import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {listModels} from '../src/ai/providers.js';
import {modelCapacity,smallModelWarning,SMALL_MODEL_WARNING} from '../public/model-capacity.js';
test('capacidad por nombre respeta el umbral y no confunde versión con parámetros',()=>{
 assert.equal(smallModelWarning('llama3.2:3b'),SMALL_MODEL_WARNING);
 assert.equal(smallModelWarning('qwen3.5:9b-mlx'),'');assert.equal(smallModelWarning('modelo:7b'),'');
 assert.equal(smallModelWarning('modelo:6.9b'),SMALL_MODEL_WARNING);assert.equal(modelCapacity('qwen3.5'),null);
 assert.equal(modelCapacity('modelo:0.5b').billions,.5);assert.equal(modelCapacity('familia-3b-instruct').billions,3);
});
test('tags permiten alias, parámetros en M y estimación conservadora según cuantización',()=>{
 assert.equal(smallModelWarning('personalizado',{parameterSize:'3.2B'}),SMALL_MODEL_WARNING);
 assert.equal(smallModelWarning('personalizado',{parameterSize:'6500M'}),SMALL_MODEL_WARNING);
 assert.equal(smallModelWarning('personalizado',{size:2e9,quantization:'Q4_K_M'}),SMALL_MODEL_WARNING);
 assert.equal(smallModelWarning('personalizado',{size:4e9,quantization:'Q4_K_M'}),'');
 assert.equal(modelCapacity('desconocido',{size:2e9}),null);assert.equal(modelCapacity('desconocido',{size:-1,quantization:'F16'}),null);
 assert.equal(modelCapacity('modelo:9b',{parameterSize:'3B'}).source,'nombre');
});
test('listado local conserva metadatos de tags sin modificar identificadores',async(t)=>{
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({models:[{name:'alias-qa',size:123456,details:{parameter_size:'3B',quantization_level:'Q4_K_M'}}]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const models=await listModels('local',{url:`http://127.0.0.1:${server.address().port}`});
 assert.deepEqual(models,[{id:'alias-qa',size:123456,parameterSize:'3B',quantization:'Q4_K_M'}]);
 assert.equal(smallModelWarning(models[0].id,models[0]),SMALL_MODEL_WARNING);
});
