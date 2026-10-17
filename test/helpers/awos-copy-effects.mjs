// Synthetic fault fixture, never loaded by the product or the backup verifier.
import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {randomUUID} from 'node:crypto';
import {openDb} from '../../src/db.js';import {createAwosClient} from '../../src/awos-client.js';import {createAwosFlow} from '../../src/awos-flow.js';
const [root,repo,mode]=process.argv.slice(2),load=p=>import(pathToFileURL(join(repo,p)).href);
const [{openWorkspaceRuntime},{FakeEmailProvider},{WorkspaceApi,InMemoryWorkspaceRepository},{deterministicProvider}]=await Promise.all([load('pymes/src/runtime-source.ts'),load('pymes/src/email-provider.ts'),load('pymes/src/workspace-api.ts'),load('pymes/tests/fixtures/pyme1-harness.ts')]);
const path=join(root,'runtime/runtime.db'),sender=new FakeEmailProvider(path+'.fake-email.db',{loseResponse:mode==='unknown',hideObservation:mode==='unknown'}),runtime=await openWorkspaceRuntime(path,'pyme1-local',{emailProvider:sender,provider:deterministicProvider});
const db=openDb(join(root,'data/pyme1.db')),repository=new InMemoryWorkspaceRepository();repository.addSession('synthetic-backup-test-token',{userId:'pyme1-owner',tenantId:'pyme1-local',role:'owner'});const api=new WorkspaceApi(repository,undefined,runtime.source);
try{
 const client=createAwosClient({port:12345,token:'synthetic-backup-test-token',fetcher:async(url,o)=>{const r=await api.handleAsync({method:o.method,path:new URL(url).pathname+new URL(url).search,authorization:o.headers.authorization,...(o.body?{body:JSON.parse(o.body)}:{})});return new Response(JSON.stringify(r.body),{status:r.status});}});
 const flow=createAwosFlow(db,client),input={opId:randomUUID(),commandId:randomUUID(),expectedVersion:0,request:'Agradece a Elena la documentación.',contactId:'qa-elena',subject:'Documento de prueba',body:'Gracias por la documentación.'};
 const v=await flow.prepare(input);await flow.decide(input.opId,1,{commandId:randomUUID(),bindingHash:v.remote.review.bindingHash,decision:'approved'});await runtime.source.email.execute(v.taskId,'pyme1-owner');
 const after=runtime.source.email.view(v.taskId,'pyme1-owner');console.log(JSON.stringify({taskId:v.taskId,status:after.status,effects:after.effects}));
}finally{db.close();runtime.close();sender.close();}
