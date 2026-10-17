import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../src/db.js';
import {previewProposalHtml,renderProposal,validateTemplate,validateVariables} from '../src/proposal-templates.js';

const base={nombre:'Propuesta base',asunto:'Propuesta para {{cliente}}',cuerpo:'{{servicio}} · {{importe}} · {{plazo}} · {{validez}}\n{{condiciones}}'};
const values={cliente:'Cliente <demo>',servicio:'Servicio & prueba',importe:'1234,5',plazo:'3 semanas',validez:'2026-12-31',condiciones:'Sin <script>alert(1)</script>'};

test('valida variables tipadas y límites',()=>{
 assert.equal(validateVariables(values).importe,'1234.50 EUR');
 assert.throws(()=>validateVariables({...values,importe:'12.345'}),/importe/);
 assert.throws(()=>validateVariables({...values,cliente:'x'.repeat(121)}),/120/);
 assert.throws(()=>validateVariables({...values,extra:'no'}),/no permitidas/);
 assert.throws(()=>validateTemplate({...base,cuerpo:'{{constructor}}'}),/no permitida/);
 assert.throws(()=>validateTemplate({...base,cuerpo:'{{cliente'}),/incompleta/);
});

test('render es determinista y la vista HTML escapa todo',()=>{
 const a=renderProposal(base,values),b=renderProposal(base,values);assert.deepEqual(a,b);assert.equal(a.subject,'Propuesta para Cliente <demo>');assert.match(a.body,/1234\.50 EUR/);
 const html=previewProposalHtml(a);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/Cliente &lt;demo&gt;/);
});

test('editar crea una versión y conserva el historial',()=>{
 const db=openDb(':memory:'),id='20000000-0000-4000-8000-000000000001';try{const one=db.proposalTemplates.create(base,{id,at:'2026-01-01T00:00:00.000Z'}),two=db.proposalTemplates.update(id,{...base,nombre:'Revisada'},{at:'2026-01-02T00:00:00.000Z'});assert.equal(one.version,1);assert.equal(two.version,2);assert.equal(db.proposalTemplates.history(id).length,2);assert.equal(db.proposalTemplates.get(id,1).nombre,'Propuesta base');assert.equal(db.proposalTemplates.list()[0].nombre,'Revisada');}finally{db.close();}
});
