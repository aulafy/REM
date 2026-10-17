import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderStaticDocument} from '../public/i18n.js';
import {displayText} from '../public/display-text.js';
import {moduleCard} from '../public/module-ui.js';
import {warningsHtml,dateWarningsHtml} from '../public/proposal-warnings.js';

test('Rendered English navigation preserves protocol identifiers and exposes draft-language selection',()=>{
 const html=renderStaticDocument(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),'en');
 assert.match(html,/<html lang="en">/);
 for(const [id,label] of [['hoy','Today'],['asistente','Assistant'],['aprobaciones','Review'],['clientes','Clients']])assert.ok(html.includes(`data-view="${id}" aria-label="${label}"`));
 assert.match(html,/Draft language/);
 assert.match(html,/name="cliente"/);assert.match(html,/\{\{cliente\}\}/);
 assert.match(html,/Approval does not send/);
});
test('English aliases preserve unknown content, primitive types and prototype-looking names',()=>{
 assert.equal(displayText('Sesión no válida. Vuelve a abrir la app.'),'Invalid session. Open the app again.');
 for(const value of ['<script>customer text</script>','__proto__','constructor','Original client note',undefined,null])assert.equal(displayText(value),value);
});
test('English built-in module labels never mutate authoritative source records',()=>{
 const item={manifest:{id:'rem.requests',kind:'requests',version:'1.0.0',name:'Solicitudes',description:'Cada conversación, un siguiente paso.',actions:['intake.messages']},installation:{version:'1.0.0',enabled:true,config:{title:'Solicitudes',subtitle:'Cada conversación, un siguiente paso.'}}};
 const before=structuredClone(item),html=moduleCard(item);assert.match(html,/Open module Requests/);assert.match(html,/A clear next step/);assert.deepEqual(item,before);
 item.installation.config.title='<img src=x onerror=1>';assert.match(moduleCard(item),/&lt;img/);assert.doesNotMatch(moduleCard(item),/<img/);
});
test('English warnings retain exact supplied values, escaping and no execution controls',()=>{
 const html=warningsHtml(['999','<script>'])+dateWarningsHtml(['16 de octubre']);assert.match(html,/999/);assert.match(html,/16 de octubre/);assert.match(html,/Check the date before approving/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<button/);
});
