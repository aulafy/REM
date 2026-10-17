import test from 'node:test';
import assert from 'node:assert/strict';
import {mountModuleLibrary} from '../public/module-library.js';
import {moduleCard,moduleDetail} from '../public/module-ui.js';
import {moduleDom} from './helpers/module-library-dom.js';

const catalog=(enabled=true,revision=1)=>({enabled:true,tenantId:'pyme1-local',ownerId:'pyme1-owner',revision,items:[{manifest:{id:'rem.requests',version:'1.0.0',sdkVersion:2,name:'Solicitudes',description:'Consultas del negocio',author:'REM',license:'MIT',renderer:'rem.process',kind:'requests',actions:['intake.messages','intake.capture'],capabilities:['crm.read','crm.write'],defaults:{title:'Solicitudes',subtitle:'Consultas del negocio'}},installation:{id:'rem.requests',version:'1.0.0',sdkVersion:2,enabled,grants:['crm.read','crm.write'],config:{title:'Solicitudes',subtitle:'Consultas del negocio'},updatedAt:1}}],audit:[]});
function setup(t,api){const h=moduleDom();const ui=mountModuleLibrary({api,onOpen:()=>{},document:h.doc});return {...h,get form(){return h.form;},get status(){return h.status;},get buttons(){return h.buttons;},ui};}
const settings=h=>h.root.querySelector('.rm-settings[data-module-detail="rem.requests"]');

test('biblioteca: al pausar desde Activos el foco vuelve al filtro visible, nunca al body',async t=>{
 const h=setup(t,async(_path,options)=>options?catalog(false,2):catalog());await h.ui.refresh();await h.click(h.filters[1]);await h.click(settings(h));h.form.elements.enabled.checked=false;h.form.elements.confirmed.checked=true;await h.submit();
 assert.equal(h.dialog.open,false);assert.equal(h.doc.activeElement,h.filters[1]);assert.match(h.grid.innerHTML,/No modules match/);
});
test('biblioteca: etiquetas accesibles incluyen texto visible y renderer escapa revisión defensivamente',()=>{
 const item=catalog().items[0];assert.match(moduleCard(item),/aria-label="Open module Requests"/);
 const html=moduleDetail(item,'" autofocus onfocus="malicioso');assert.doesNotMatch(html,/value="" autofocus/);assert.match(html,/&quot; autofocus/);
});
test('biblioteca: no conserva contadores ni acciones antiguos si se deshabilita el motor',async t=>{
 let calls=0;const h=setup(t,async()=>++calls===1?catalog():{enabled:false});await h.ui.refresh();assert.equal(h.fixed['rm-active-count'].textContent,'1');await h.ui.refresh();assert.equal(h.fixed['rm-active-count'].textContent,'—');assert.match(h.fixed['rm-included'].textContent,/not enabled/);assert.doesNotMatch(h.grid.innerHTML,/data-module-open/);
});
test('biblioteca: pérdida de respuesta conserva el cuerpo exacto y commandId; explica el bloqueo',async t=>{
 const writes=[];let fail=true;const h=setup(t,async(_path,options)=>{if(!options)return catalog();writes.push(structuredClone(options.body));if(fail){fail=false;throw Error('respuesta perdida');}return catalog(true,2);});await h.ui.refresh();await h.click(settings(h));h.form.elements.confirmed.checked=true;h.form.elements.title.value='Consultas del estudio';await h.submit();assert.equal(h.form.elements.title.disabled,true);assert.match(h.status.textContent,/fields|locked/i);h.form.elements.title.value='cambio programático posterior';await h.submit();assert.deepEqual(writes[1],writes[0]);assert.equal(writes.length,2);assert.equal(h.dialog.open,false);
});
test('biblioteca: conflicto ofrece relectura explícita y exige una nueva confirmación sin escribir',async t=>{
 let reads=0,writes=0;const h=setup(t,async(_path,options)=>{if(!options){reads++;return catalog(true,reads===1?1:4);}writes++;throw Object.assign(Error('conflicto'),{code:'CAPSULE_REVISION_CONFLICT'});});await h.ui.refresh();await h.click(settings(h));h.form.elements.confirmed.checked=true;await h.submit();assert.equal(h.dialog.querySelector('#rm-save').disabled,true);const reload=h.dialog.querySelector('[data-module-reload="true"]');assert.ok(reload&&!reload.hidden);await h.click(reload);assert.equal(reads,2);assert.equal(writes,1);assert.equal(h.form.elements.revision.value,'4');assert.equal(h.form.elements.title.disabled,false);assert.equal(h.form.elements.confirmed.checked,false);assert.equal(h.dialog.open,true);
});
test('biblioteca: error real deja estado no disponible sin datos demo ni acciones obsoletas',async t=>{
 let fail=false;const h=setup(t,async()=>{if(fail)throw Error('offline');return catalog();});await h.ui.refresh();fail=true;await h.ui.refresh();assert.match(h.grid.innerHTML,/role="alert"/);assert.match(h.fixed['rm-status'].textContent,/Could not confirm/);assert.doesNotMatch(h.grid.innerHTML,/data-module-open/);assert.equal(h.fixed['rm-active-count'].textContent,'—');
});
test('biblioteca: cerrar una petición incierta solo relee y deja foco en un control que no se reemplaza',async t=>{
 let reads=0,writes=0;const h=setup(t,async(_path,options)=>{if(options){writes++;throw Error('respuesta perdida');}reads++;return catalog();});await h.ui.refresh();await h.click(settings(h));h.form.elements.confirmed.checked=true;await h.submit();h.cancel();await new Promise(r=>setImmediate(r));assert.equal(reads,2);assert.equal(writes,1);assert.equal(h.doc.activeElement,h.filters[0]);assert.equal(h.dialog.open,false);
});
test('biblioteca: si falla actualizar un conflicto el guardado sigue bloqueado y no se crea otro comando',async t=>{
 let reads=0,writes=0;const h=setup(t,async(_path,options)=>{if(options){writes++;throw Object.assign(Error('conflicto'),{code:'CAPSULE_REVISION_CONFLICT'});}if(++reads>1)throw Error('motor caído');return catalog();});await h.ui.refresh();await h.click(settings(h));h.form.elements.confirmed.checked=true;await h.submit();await h.click(h.dialog.querySelector('[data-module-reload="true"]'));assert.match(h.status.textContent,/Could not refresh/);assert.equal(h.dialog.querySelector('#rm-save').disabled,true);await h.submit();assert.equal(writes,1);assert.equal(h.form.elements.confirmed.checked,true);assert.equal(h.form.elements.title.disabled,true);
});
test('biblioteca: una versión obsoleta queda fuera de Activos igual que del contador y conserva acceso a su revisión',async t=>{
 const state=catalog();state.items[0].installation.version='0.9.0';const h=setup(t,async()=>state);await h.ui.refresh();assert.equal(h.fixed['rm-active-count'].textContent,'0');assert.match(h.grid.innerHTML,/Review version/);await h.click(h.filters[1]);assert.match(h.grid.innerHTML,/No modules match/);await h.click(h.filters[0]);assert.match(h.grid.innerHTML,/data-module-detail/);assert.doesNotMatch(h.grid.innerHTML,/data-module-open/);
});
