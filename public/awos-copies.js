const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Date(v).toLocaleString('en-GB');
const names={create:'Coordinated copy',import:'Import saved copy',restore:'Separate restoration',open:'Open restored environment',resume:'Resume runtime'};
const errors={AWOS_COPY_SELECTION_CANCELLED:'No folder was selected. Nothing was imported.',AWOS_COPY_PICKER_UNAVAILABLE:'Could not open the macOS folder picker. You can retry.',AWOS_COPY_REPLAY_OR_PAIR_INVALID:'Database/history verification failed. The copy was not imported.',AWOS_COPY_OUTPUT_OVERLAP:'The folder is already in this catalog. Use the existing copy to restore.',AWOS_COPY_LAYOUT_INVALID:'The folder is not a coordinated copy package.',AWOS_COPY_MANIFEST_INVALID:'The copy manifest is invalid.',AWOS_COPY_HASH_MISMATCH:'Files do not match the manifest. The copy was not imported.',AWOS_COPY_CHANGED:'The copy changed. Refresh and select it again.',AWOS_COPY_UNAVAILABLE:'The copy or temporary environment is no longer available.',AWOS_RESTORED_SESSION_CLOSED:'The environment is closed. You can open it again.',AWOS_START_FAILED:'AWOS could not start. The verified copy may still be available.',AWOS_START_TIMEOUT:'AWOS did not respond on startup. Check the copy and retry resuming the runtime.'};
const phases={selecting:'Select a folder in the macOS dialog',selected:'Folder selected; identity saved',importing:'Verifying copy files and history',closed:'The restored environment is closed',queued:'Queued',pausing:'Draining operations and pausing AWOS',validated:'Copy verified; saving',restoring:'Verifying and restoring into a new folder',opening:'Starting the restored environment',resuming:'Resuming AWOS',completed:'Completed',recovered:'Recovered after restart',failed:'Operation unconfirmed',interrupted:'Interrupted; check or retry',missing:'The copy or environment is no longer available',invalid:'Could not verify'};
export function restoredUrl(value){try{const u=new URL(value);return u.protocol==='http:'&&u.hostname==='127.0.0.1'&&/^\d+$/.test(u.port)&&Number(u.port)>=1024&&Number(u.port)!==4317&&u.pathname==='/'&&u.hash==='#awos'&&!u.username&&!u.password&&!u.search?u.href:null;}catch{return null;}}
export function parseCopiesStatus(data){
 const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v),count=v=>Number.isSafeInteger(v)&&v>=0,code=v=>v===null||typeof v==='string'&&/^AWOS_[A-Z0-9_]+$/.test(v);
 if(data?.enabled===false)return data;
 if(!data||data.enabled!==true||typeof data.busy!=='boolean'||typeof data.runtimeReady!=='boolean'||!Array.isArray(data.copies)||!Array.isArray(data.jobs)||data.copies.length>100||data.jobs.length>100)throw Error('Unrecognized copy response. Refresh to check the actual state.');
 for(const c of data.copies)if(!id(c.copyId)||c.error&&!code(c.error)||!c.error&&(typeof c.manifestHash!=='string'||!/^[a-f0-9]{64}$/.test(c.manifestHash)||!Number.isFinite(Date.parse(c.createdAt))||!count(c.bytes)||!count(c.summary?.reviews)||!count(c.summary?.crmLeads)))throw Error('Cannot verify the displayed copy.');
 for(const j of data.jobs)if(!id(j.id)||!['create','import','restore','open','resume'].includes(j.kind)||!['running','completed','failed','interrupted'].includes(j.state)||typeof j.phase!=='string'||!count(j.created)||!count(j.updated)||!code(j.error)||j.kind==='open'&&j.state==='completed'&&!restoredUrl(j.result?.url))throw Error('Cannot verify the recovery result.');
 return data;
}
export function copiesHtml(data,selection=null){
 data=parseCopiesStatus(data);if(!data.enabled)return '';
 const busy=!!data.busy,disabled=busy?' disabled':'';
 return `<div class="awos-list-head"><h3>Coordinated copies and recovery</h3><button type="button" data-copy-refresh>Refresh copies</button></div>
 <p class="help">Includes REM, reviews, decisions, CRM, and module configuration for this experiment. Sending remains disabled.</p>
 <p class="help">Creating a copy briefly pauses the runtime. Restore creates a separate environment and preserves the current one. Keep a copy outside the temporary folder for longer-term use.</p>
 ${data.runtimeReady===false?'<p role="alert">AWOS is unavailable. Copies and recovery history remain accessible.</p><button type="button" data-copy-resume'+disabled+'>Resume runtime</button>':''}
 <button type="button" data-copy-create${disabled}>Create coordinated copy</button> <button type="button" data-copy-import${disabled}>Import saved copy…</button>
 <p class="help">Import only your own copies from this experiment. Select the folder containing manifest.json in the macOS dialog. A verified copy is added to the catalog; it is not restored or opened automatically. Hashes do not certify provenance.</p>
 ${busy?'<p role="status">A recovery operation is in progress. You can check its progress.</p>':''}
 <div class="copy-items">${(data.copies??[]).map(c=>`<article class="awos-card"><h4>${c.error?'Backup unavailable':'Copy from '+esc(date(c.createdAt))}</h4>${c.error?`<p role="alert">The copy is unavailable or has changed. It cannot be restored.</p>`:`<p>${esc(Math.ceil(c.bytes/1024))} KB · ${esc(c.summary?.reviews??0)} reviews · ${esc(c.summary?.crmLeads??0)} opportunities</p><button type="button" data-copy-select="${esc(c.copyId)}"${disabled}>Restore into another environment</button> <button type="button" data-copy-reveal="${esc(c.copyId)}"${disabled}>Show in Finder</button>`}</article>`).join('')||'<div class="empty-state"><div><h3>No coordinated copies</h3><p>Create one to retain REM and the experimental history.</p></div></div>'}</div>
 ${selection?`<form id="copy-confirm"><h4>Restore into a new environment</h4><p>Copy from ${esc(date(selection.createdAt))}: ${esc(selection.summary?.reviews??0)} reviews. The current instance and its history are retained.</p><label>Type RESTAURAR to confirm<input name="confirmation" autocomplete="off" required aria-label="Restore confirmation"></label><button type="submit"${disabled}>Create restored environment</button> <button type="button" data-copy-dismiss>Back</button></form>`:''}
 <h4>Recovery activity</h4>${(data.jobs??[]).map(j=>`<article class="awos-card"><strong>${esc(names[j.kind]??'Recovery')}</strong><p>${esc(phases[j.phase]??j.state)} · ${esc(date(j.updated))}</p>${j.error?`<p role="alert">${esc(errors[j.error]??'Could not confirm the operation. Check its result before retrying.')}</p>`:''}${['failed','interrupted'].includes(j.state)?`<button type="button" data-copy-retry="${esc(j.id)}"${disabled}>Check and retry</button>`:''}${j.kind==='restore'&&j.state==='completed'?`<button type="button" data-copy-open="${esc(j.id)}"${disabled}>Prepare restored environment launch</button>`:''}${j.kind==='open'&&j.state==='completed'&&restoredUrl(j.result?.url)?`<a class="btn" target="_blank" rel="noopener noreferrer" href="${esc(restoredUrl(j.result.url))}">Open restored environment</a>`:''}</article>`).join('')||'<p>No recovery operations.</p>'}`;
}
export function mountCopies({api,document:doc=document,setTimer=setTimeout,clearTimer=clearTimeout}){
 const root=doc.getElementById('awos-copies');if(!root)return;
 let data=null,selection=null,timer=null,requesting=false,pending=null;
 const status=doc.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');const content=doc.createElement('div');root.append(status,content);
 const message=text=>{status.textContent=text;};
 async function refresh(){
  clearTimer(timer);const wasBusy=!!data?.busy;try{data=parseCopiesStatus(await api('/api/awos/copies'));root.hidden=!data.enabled;if(!data.enabled)return;
   if(selection&&!data.copies.some(c=>!c.error&&c.copyId===selection.copyId&&c.manifestHash===selection.manifestHash)){selection=null;message('The copy changed or is unavailable. Select it again.');}
   content.innerHTML=copiesHtml(data,selection);if(data.busy)timer=setTimer(refresh,700);else if(wasBusy)doc.dispatchEvent(new CustomEvent('awos-copy-changed'));return data;
  }catch(e){content.innerHTML='';root.hidden=false;message('Cannot confirm copy state. '+e.message);}
 }
 async function send(kind,input){
  if(requesting)return;requesting=true;
  if(!pending||pending.kind!==kind||JSON.stringify(pending.value)!==JSON.stringify(input))pending={kind,value:input,body:{requestId:crypto.randomUUID(),...input}};
  try{await api('/api/awos/copies/'+kind,{method:'POST',body:pending.body});pending=null;selection=null;message('Request recorded. Check its result and progress.');}
  catch(e){message('Operation unconfirmed. Consulta la actividad antes de repetir. '+e.message);}
  finally{requesting=false;await refresh();if(!data?.busy)doc.dispatchEvent(new CustomEvent('awos-copy-changed'));}
 }
 root.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.hasAttribute('data-copy-refresh'))return refresh();
  if(b.hasAttribute('data-copy-create'))return send('create',{});
  if(b.hasAttribute('data-copy-import'))return send('import',{});
  if(b.hasAttribute('data-copy-resume'))return send('resume',{});
  if(b.dataset.copySelect){selection=data.copies.find(c=>c.copyId===b.dataset.copySelect&&!c.error)??null;content.innerHTML=copiesHtml(data,selection);return;}
  if(b.hasAttribute('data-copy-dismiss')){selection=null;content.innerHTML=copiesHtml(data);return;}
  if(b.dataset.copyOpen)return send('open',{restoreId:b.dataset.copyOpen});
  if(b.dataset.copyRetry){try{await api('/api/awos/copies/retry',{method:'POST',body:{requestId:b.dataset.copyRetry}});message('Checking and recovering the same operation.');}catch(e){message(e.message);}return refresh();}
  if(b.dataset.copyReveal){try{await api('/api/awos/copies/reveal',{method:'POST',body:{copyId:b.dataset.copyReveal}});message('Backup shown in Finder.');}catch(e){message(e.message);}return;}
 });
 root.addEventListener('submit',e=>{if(e.target.id!=='copy-confirm')return;e.preventDefault();if(!selection)return;const confirmation=e.target.elements.confirmation.value;if(confirmation!=='RESTAURAR'){message('Type RESTAURAR exactly to confirm.');return;}return send('restore',{copyId:selection.copyId,manifestHash:selection.manifestHash,confirmation});});
 return {refresh,stop:()=>clearTimer(timer)};
}

// Loading the read model may be retried across a maintenance window. This helper
// never submits a command or repeats an approval, restore or provider action.
export async function loadAroundMaintenance(load,onMaintenance,wait=()=>new Promise(ok=>setTimeout(ok,500))){
 for(;;)try{return await load();}catch(e){if(e.code!=='AWOS_MAINTENANCE')throw e;await onMaintenance(e);await wait();}
}
