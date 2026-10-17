import {displayText} from './display-text.js';
import {parseModuleCatalog,moduleKit,MODULE_KINDS} from './module-contract.js';
import {moduleCard,moduleDetail,moduleError} from './module-ui.js';

export function mountModuleLibrary({api,onOpen,document:doc=globalThis.document}){
 const root=doc.getElementById('v-modulos');if(!root)return;
 const grid=root.querySelector('#rm-grid'),count=root.querySelector('#rm-result-count'),status=root.querySelector('#rm-status');
 const dialog=doc.getElementById('rm-module-dialog'),search=root.querySelector('#rm-search');
 let catalog=null,filter='all',selected=null,pending=null,busy=false,conflict=false,opener=null,generation=0;
 const feedback=text=>{status.textContent=text;};
 const fold=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('es');
 const active=item=>!!item.installation?.enabled&&item.installation.version===item.manifest.version;

 function render(){
  const q=fold(search.value).trim();
  const items=catalog.items.filter(i=>{
   const text=fold([displayText(i.manifest.name),displayText(i.manifest.description),displayText(i.installation?.config.title)??'',MODULE_KINDS[i.manifest.kind].group].join(' '));
   return (!q||text.includes(q))&&(filter==='all'||filter==='active'&&active(i)||filter==='paused'&&i.installation&&!i.installation.enabled);
  });
  grid.innerHTML=items.length?items.map(moduleCard).join(''):'<div class="rm-empty"><h3>No modules match this filter</h3><p>Try another name or choose All.</p><button class="rm-secondary" data-module-clear>Clear filters</button></div>';
  count.textContent=`${items.length} ${items.length===1?'module':'modules'}`;
  root.querySelector('#rm-included').textContent=`${catalog.items.length} reusable modules`;
  root.querySelector('#rm-active-count').textContent=String(catalog.items.filter(active).length);
 }
 async function refresh(){
  const ticket=++generation;root.setAttribute('aria-busy','true');feedback('Checking module status…');
  try{
   const v=await api('/api/awos/modules');if(ticket!==generation)return;
   if(!v.enabled){
    catalog=null;root.querySelector('#rm-active-count').textContent='—';root.querySelector('#rm-included').textContent='Runtime not enabled';
    grid.innerHTML='<div class="rm-empty"><h3>Workspace processes are not enabled yet</h3><p>Your implementer can enable this library while configuring your business workflows.</p></div>';
    count.textContent='Runtime not enabled';feedback('No operational modules are active in this installation.');return;
   }
   catalog=parseModuleCatalog(v);render();feedback('State updated. This configuration does not enable automatic sending.');
  }catch{
   if(ticket!==generation)return;catalog=null;root.querySelector('#rm-active-count').textContent='—';root.querySelector('#rm-included').textContent='Runtime unavailable';
   grid.innerHTML=moduleError();count.textContent='Unavailable';feedback('Could not confirm the state. No sample data was substituted.');
  }finally{if(ticket===generation)root.setAttribute('aria-busy','false');}
 }
 function returnFocus(id,stable=false){
  const kind=opener?.classList.contains('rm-settings')?'rm-settings':'rm-open';
  const equivalent=root.querySelector(`.${kind}[data-module-open="${id}"]`)??root.querySelector(`.${kind}[data-module-detail="${id}"]`);
  const fallback=root.querySelector(`[data-module-filter="${filter}"]`)??search;
  const target=stable?fallback:opener?.isConnected?opener:equivalent??fallback;
  target?.focus();
 }
 function close(){
  if(busy)return;const id=selected?.manifest.id,unknown=!!pending;dialog.close();selected=null;pending=null;conflict=false;returnFocus(id,unknown);
  if(unknown)void refresh();
 }
 function fillDetail(item){
  selected=item;pending=null;conflict=false;dialog.innerHTML=moduleDetail(item,catalog.revision,catalog.audit);
 }
 function detail(id,button){
  const item=catalog?.items.find(i=>i.manifest.id===id);if(!item)return;
  opener=button;fillDetail(item);dialog.showModal();dialog.querySelector('input[name="title"]').focus();
 }
 function lockButtons(){dialog.querySelectorAll('button').forEach(n=>n.disabled=busy||n.dataset.blocked==='1');}
 async function reloadDetail(){
  if(busy||!conflict||!selected)return;
  const id=selected.manifest.id,ticket=++generation;busy=true;lockButtons();root.setAttribute('aria-busy','true');
  const message=dialog.querySelector('#rm-dialog-status');message.textContent='Reading the current configuration. No changes will be saved.';
  try{
   const v=parseModuleCatalog(await api('/api/awos/modules'));
   if(ticket!==generation){message.textContent='A newer request exists. Refresh this dialog again before saving.';return;}
   const item=v.items.find(i=>i.manifest.id===id);if(!item)throw Error('MODULE_NOT_AVAILABLE');
   catalog=v;render();fillDetail(item);dialog.querySelector('input[name="title"]').focus();
   dialog.querySelector('#rm-dialog-status').textContent='Configuration refreshed. Review the fields and confirm again before saving.';
  }catch{message.textContent='Could not refresh the dialog. Saving remains blocked; try again or close it.';}
  finally{busy=false;lockButtons();if(ticket===generation)root.setAttribute('aria-busy','false');}
 }
 root.addEventListener('input',e=>{if(e.target===search&&catalog)render();});
 root.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.moduleRefresh!==undefined){void refresh();return;}
  if(b.dataset.moduleFilter){filter=b.dataset.moduleFilter;root.querySelectorAll('[data-module-filter]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));if(catalog)render();return;}
  if(b.dataset.moduleClear!==undefined){search.value='';filter='all';root.querySelector('[data-module-filter="all"]').click();search.focus();return;}
  if(b.dataset.moduleDetail){detail(b.dataset.moduleDetail,b);return;}
  if(b.dataset.moduleOpen){const item=catalog?.items.find(i=>i.manifest.id===b.dataset.moduleOpen);if(item&&active(item))onOpen(item);}
 });
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.moduleClose!==undefined){close();return;}
  if(b.dataset.moduleReload!==undefined){void reloadDetail();return;}
  if(b.dataset.moduleKit){
   const item=catalog?.items.find(i=>i.manifest.id===b.dataset.moduleKit);if(!item)return;
   const url=URL.createObjectURL(new Blob([moduleKit(item)],{type:'text/markdown;charset=utf-8'})),a=doc.createElement('a');
   a.href=url;a.download='REM_MODULO_'+item.manifest.kind+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
 });
 dialog.addEventListener('submit',async e=>{
  if(e.target.id!=='rm-config-form')return;e.preventDefault();if(busy||conflict||!selected||!catalog)return;
  const f=e.target,m=selected.manifest;
  // A lost response keeps this exact command, even if controls change programmatically.
  if(!pending)pending={sdkVersion:2,capsuleId:m.id,version:m.version,expectedRevision:Number(f.elements.revision.value),enabled:f.elements.enabled.checked,grants:m.capabilities,config:{title:f.elements.title.value.trim(),subtitle:f.elements.subtitle.value.trim()},commandId:crypto.randomUUID()};
  busy=true;f.querySelectorAll('input,textarea').forEach(n=>n.disabled=true);lockButtons();
  const message=dialog.querySelector('#rm-dialog-status');message.textContent='Saving the same configuration…';
  try{
   const v=await api('/api/awos/modules/configure',{method:'POST',body:pending});catalog=parseModuleCatalog(v);pending=null;render();busy=false;close();
   feedback('Configuration saved. Work and history are retained.');doc.dispatchEvent(new CustomEvent('rem-modules-changed'));
  }catch(err){
   conflict=err.code==='CAPSULE_REVISION_CONFLICT';
   message.textContent=conflict?'Another session changed the modules. Refresh this dialog, review the configuration, and confirm again.':'The change is unconfirmed. Fields stay locked to preserve the exact request. Recovering the same request does not create another decision.';
   dialog.querySelector('#rm-save').textContent=conflict?'Refresh required':'Recover the same request';
   dialog.querySelector('#rm-save').dataset.blocked=conflict?'1':'0';
   dialog.querySelector('[data-module-reload="true"]').hidden=!conflict;
  }finally{busy=false;lockButtons();}
 });
 return {refresh};
}
