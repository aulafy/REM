import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {catalogs,translate,t,setLanguage,getLanguage,detectLanguage,localized,formatDate,formatNumber,formatMoney,renderStaticDocument,bindValue,onLanguageChange,patchTranslatedHtml} from '../public/i18n.js';
import {createLanguagePreference} from '../public/language-preference.js';
import {checkI18n,catalogProblems,fixedCopy,staticCopy} from '../scripts/check-i18n.mjs';
import {openDb} from '../src/db.js';
import {saveSettings,loadSettings} from '../src/settings.js';
import {makeSecrets} from '../src/secrets.js';
import {createApp} from '../src/api.js';
import {draftingRequest} from '../src/draft-context.js';
import {askAgent} from '../src/agent.js';
import {triage} from '../src/triage.js';
import {resolveDate,taskTitle} from '../src/dates.js';
import {relativePeriods,draftingDateReferences,unexpectedDates} from '../src/draft-dates.js';
import {renderProposal,renderFollowup} from '../src/proposal-templates.js';
import {operationHtml} from '../public/awos-panel.js';
import {dateWarningsHtml} from '../public/proposal-warnings.js';

const source=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const staticDir=new URL('../public',import.meta.url).pathname;
const base=new Date('2026-10-10T10:00:00Z');
function memory(t){const db=openDb(':memory:');t.after(()=>db.close());return db;}

test('catalogues match every key, slot and nonlinguistic markup contract; UI source has no fixed copy',()=>{
 assert.deepEqual(checkI18n().problems,[]);assert.ok(Object.keys(catalogs.es).length>700);
 assert.throws(()=>translate('en','not.a.real.key'),/I18N_KEY_MISSING/);
 assert.deepEqual(catalogProblems({x:'Hello ⟦0⟧'},{x:'Hola'}).map(p=>p.error),['PLACEHOLDER_MISMATCH']);
 assert.deepEqual(catalogProblems({x:'Hello'},{}).map(p=>p.error),['MISSING_TRANSLATION']);
 assert.deepEqual(catalogProblems({x:'<button data-id="one">Go</button>'},{x:'<button data-id="two">Ir</button>'}).map(p=>p.error),['MARKUP_CONTRACT_MISMATCH']);
 assert.ok(fixedCopy('node.textContent = "Untranslated label";').length);
 assert.ok(fixedCopy('node.textContent = "hello";').length);
 assert.ok(fixedCopy('node.setAttribute("aria-label", "Close window");').length);
 assert.ok(staticCopy('<button aria-label="Close window">Close</button>').length);
 assert.deepEqual(fixedCopy('node.querySelector("#panel button"); if(e.key === "Enter") go(); fetch("/api/state");'),[]);
 assert.deepEqual(staticCopy('<button data-i18n="ui.close" data-i18n-aria-label="ui.close" aria-label="{{i18n:ui.close}}">{{i18n:ui.close}}</button>'),[]);
});

test('static rendering translates accessible labels and lang without changing routes, business placeholders or CSP token',()=>{
 const en=renderStaticDocument(source,'en'),es=renderStaticDocument(source,'es');
 assert.match(en,/<html lang="en">/);assert.match(es,/<html lang="es">/);
 assert.match(en,/aria-label="Today"/);assert.match(es,/aria-label="Hoy"/);
 for(const html of [en,es]){assert.match(html,/name="cliente"/);assert.match(html,/\{\{cliente\}\}/);assert.match(html,/__PYME1_TOKEN__/);assert.doesNotMatch(html,/\{\{i18n:/);}
});

test('browser primary language only, unsupported fallback Spanish, explicitly saved preference wins',async()=>{
 assert.equal(detectLanguage(['en-GB','es']),'en');assert.equal(detectLanguage(['es-MX']),'es');assert.equal(detectLanguage(['fr-FR','en']),'es');assert.equal(detectLanguage([]),'es');
 let settings={language:null},writes=[];
 const pref=()=>createLanguagePreference({readSettings:()=>settings,writeSettings:s=>settings=s,languages:['en-GB'],save:async patch=>{writes.push(patch);return {...settings,...patch};}});
 await pref().initialize();assert.equal(getLanguage(),'en');assert.deepEqual(writes,[{language:'en'}]);
 await pref().choose('es');assert.equal(settings.language,'es');await pref().initialize();assert.equal(getLanguage(),'es');assert.equal(writes.length,2);
 await assert.rejects(pref().choose('fr'),/I18N_LANGUAGE_INVALID/);setLanguage('en');
});

test('preference failure rolls the interface back and never dispatches a workflow or concurrent settings write',async()=>{
 setLanguage('en');let finish,writes=0;const wait=new Promise(r=>finish=r),pref=createLanguagePreference({readSettings:()=>({language:'en'}),writeSettings:()=>assert.fail('unconfirmed setting'),save:async p=>{assert.deepEqual(p,{language:'es'});writes++;await wait;throw Error('offline');}});
 const changing=pref.choose('es');assert.equal(getLanguage(),'es');assert.equal(pref.pending,true);await assert.rejects(pref.choose('en'),/I18N_SAVE_PENDING/);finish();await assert.rejects(changing,/offline/);assert.equal(getLanguage(),'en');assert.equal(writes,1);assert.equal(pref.pending,false);
});

test('language persists on disk across restart without changing drafts, decisions or audit',t=>{
 const root=mkdtempSync(join(tmpdir(),'rem-i18n-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'rem.db');let db=openDb(path);
 const draft=db.proposals.create('redactar_mensaje',{cliente:'Synthetic <b>Today</b>',texto:'Gracias. This original must remain literal.',canal:'correo',avisos:['999']},'asistente');
 db.proposals.decide(draft.id,'approved',draft.payload,{text:draft.payload.texto});const before=db.proposals.get(draft.id),audit=db.audit.list();saveSettings(db,{language:'es'});db.close();db=openDb(path);try{assert.equal(loadSettings(db).language,'es');assert.deepEqual(db.proposals.get(draft.id),before);assert.deepEqual(db.audit.list(),audit);assert.throws(()=>saveSettings(db,{language:'fr'}),/español o inglés/);}finally{db.close();}
});

test('locale formatters use Intl en-GB/es-ES and Madrid across DST; codes and supplied drafts remain literal',()=>{
 for(const lang of ['en','es']){setLanguage(lang);assert.equal(formatNumber(12345.5),new Intl.NumberFormat(lang==='en'?'en-GB':'es-ES').format(12345.5));assert.equal(formatMoney(1234.5),new Intl.NumberFormat(lang==='en'?'en-GB':'es-ES',{style:'currency',currency:'EUR'}).format(1234.5));
 assert.equal(formatDate('2026-10-20T10:00:00Z',{hour:'2-digit',minute:'2-digit'}),'12:00');assert.equal(formatDate('2026-10-27T10:00:00Z',{hour:'2-digit',minute:'2-digit'}),'11:00');
 const html=operationHtml({opId:'synthetic',version:1,latest:true,state:'uncertain',remote:{effects:[{status:'unknown'}],audit:[]}});assert.doesNotMatch(html,/<button/);assert.match(html,lang==='es'?/incierto/i:/Uncertain/);assert.ok(dateWarningsHtml(['October 19']).includes('October 19'));
 }setLanguage('en');
});

test('reactive labels refresh after field restoration and do not replace business identities',()=>{
 const labels=localized(()=>({heading:t('common.proposals')}));let callback;
 const unsubscribe=onLanguageChange(lang=>callback=lang);setLanguage('es');assert.equal(labels.heading,'propuestas');assert.equal(callback,'es');setLanguage('en');assert.equal(labels.heading,'proposals');unsubscribe();
});

// Deliberate minimal DOM, not browser/layout QA. Rebuilds emulate real innerHTML replacement.
function editingDom(){
 const doc={nodeType:9,activeElement:null,documentElement:{lang:'en'}};
 const parent={id:'panel',tagName:'DIV',nodeType:1,parentElement:null,isConnected:true};
 let controls=[];
 const make=(id,tagName,value)=>({id,tagName,nodeType:1,parentElement:parent,isConnected:true,value,checked:false,disabled:false,hidden:false,dataset:{},selectionStart:2,selectionEnd:5,selectionDirection:'forward',setSelectionRange(a,b,d){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=d;},focus(){doc.activeElement=this;},setAttribute(){}});
 const rebuild=()=>{for(const c of controls)c.isConnected=false;controls=[make('draft','TEXTAREA','server default'),make('secret','INPUT',''),make('confirm','INPUT','on'),make('save','BUTTON',''),make('retry','BUTTON','')];parent.children=controls;};
 rebuild();Object.defineProperty(parent,'innerHTML',{get(){return this.html||'';},set(value){this.html=value;rebuild();}});
 doc.querySelectorAll=s=>s==='*'?[parent,...controls]:s==='input,textarea,select,button'?controls:s==='[id]'?[parent,...controls]:[];
 doc.getElementById=id=>[parent,...controls].find(c=>c.id===id);return {doc,parent,get controls(){return controls;}};
}
test('switch preserves unsaved draft, password, checks, selection, focus, hidden and blocked buttons across a parent rebuild',()=>{
 setLanguage('en');const h=editingDom();bindValue(h.parent,'innerHTML',()=>t('common.proposals'));let [draft,secret,confirm,save,retry]=h.controls;
 draft.value='Unsubmitted customer text <b>Hoy</b>';secret.value='synthetic-private-value';confirm.checked=true;draft.focus();save.disabled=true;save.dataset.blocked='unconfirmed';retry.hidden=true;
 bindValue(save,'textContent',()=>t('common.proposals'));setLanguage('es',{document:h.doc});[draft,secret,confirm,save,retry]=h.controls;
 assert.equal(h.parent.innerHTML,'propuestas');assert.equal(draft.value,'Unsubmitted customer text <b>Hoy</b>');assert.equal(secret.value,'synthetic-private-value');assert.equal(confirm.checked,true);assert.equal(save.disabled,true);assert.equal(save.dataset.blocked,'unconfirmed');assert.equal(retry.hidden,true);assert.equal(save.textContent,'propuestas');assert.equal(h.doc.activeElement,draft);assert.deepEqual([draft.selectionStart,draft.selectionEnd],[2,5]);assert.equal(h.doc.documentElement.lang,'es');
 setLanguage('en',{document:h.doc});assert.equal(h.controls[3].textContent,'proposals');assert.equal(h.controls[3].disabled,true);h.parent.isConnected=false;for(const c of h.controls)c.isConnected=false;
});

test('English and Spanish drafts see minimum context; only explicitly requested records are included',t=>{
 const db=memory(t),client=db.clients.create({name:'Nora Sample',notes:'Her policy expires 28 October. Secret unrelated CODE001.'});db.tasks.create({client_id:client.id,title:'Appointment for Nora',due:'2026-10-13'});
 for(const language of ['es','en']){const req=draftingRequest(db,'Write an email to Nora thanking her for the help',base,{language});assert.deepEqual(Object.keys(req.input),['cliente','canal','peticion']);assert.doesNotMatch(req.system+JSON.stringify(req.messages),/CODE001|28 October|2026-10-13/);assert.match(req.system,language==='en'?/inglés \(English\)/:/español/);}
 const explicit=draftingRequest(db,'Write Nora about the appointment on Tuesday',base,{language:'en'});assert.deepEqual(explicit.input.datos_mencionados,[{fuente:'tarea',titulo:'Appointment for Nora',fecha:'2026-10-13'}]);
});

test('English relative deadlines remain literal; legitimate dates are authorized only by the current request',()=>{
 assert.equal(resolveDate('Call Nora tomorrow',base),'2026-10-11');assert.equal(taskTitle('Call Nora on Tuesday',base),'Call Nora');assert.equal(resolveDate('tomorrow and Tuesday',base),'');
 assert.deepEqual(relativePeriods('It expires in 15 days').map(p=>p.expression),['in 15 days']);assert.deepEqual(draftingDateReferences('It expires in 15 days',base),[]);
 assert.equal(draftingDateReferences('Write Nora on Tuesday',base)[0].date,'2026-10-13');assert.match(draftingDateReferences('Write Nora on Tuesday',base)[0].human,/Tuesday/);
 assert.deepEqual(unexpectedDates('Write Nora about Tuesday',{texto:'We will call on 13 October 2026.'},base),[]);
 assert.deepEqual(unexpectedDates('It expires in 15 days',{texto:'It expires on October 25, 2026.'},base),['October 25, 2026']);
 assert.deepEqual(unexpectedDates('Thank Nora',{texto:'We meet on 13 October 2026.'},base),['13 October 2026']);
});

test('Madrid scheduling and business date are host-zone independent, including spring gap and autumn repeated hour',()=>{
 const code=`import assert from 'node:assert/strict';import {followupInstant,followupLocalValue} from './public/followup-controls.js';import {resolveDate} from './src/dates.js';assert.equal(followupLocalValue('2026-10-20T10:00:00Z'),'2026-10-20T12:00');assert.equal(followupInstant('2026-10-20T12:00'),'2026-10-20T10:00:00.000Z');assert.throws(()=>followupInstant('2027-03-28T02:30'));assert.equal(followupInstant('2026-10-25T02:30'),'2026-10-25T00:30:00.000Z');assert.equal(resolveDate('today',new Date('2026-10-10T23:30:00Z')),'2026-10-11');`;
 for(const TZ of ['UTC','America/Los_Angeles','Europe/Madrid'])execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),env:{...process.env,TZ},stdio:'pipe'});
});

test('template language is versioned; old versions survive restart and money display never changes canonical variables',t=>{
 const root=mkdtempSync(join(tmpdir(),'rem-template-lang-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let db=openDb(join(root,'rem.db'));
 const tpl={nombre:'Proposal',asunto:'Proposal {{cliente}}',cuerpo:'{{servicio}}: {{importe}}',language:'en'},values={cliente:'Nora',servicio:'Audit',importe:'1234.50',plazo:'15 days',validez:'30 days',condiciones:'Review only'};
 const first=db.proposalTemplates.create(tpl),second=db.proposalTemplates.update(first.id,{...tpl,language:'es',asunto:'Propuesta {{cliente}}'});assert.equal(second.version,2);db.close();db=openDb(join(root,'rem.db'));
 try{const original=db.proposalTemplates.get(first.id,1);assert.deepEqual(original,first);const rendered=renderProposal(original,values,{language:'en'});assert.match(rendered.body,/€1,234\.50/);assert.equal(rendered.variables.importe,'1234.50 EUR');assert.throws(()=>renderProposal(original,values,{language:'es'}),/idioma/);assert.match(renderProposal(second,values,{language:'es'}).body,/1234,50/);assert.match(renderProposal(first,values).body,/1234\.50 EUR/);assert.match(renderFollowup({cliente:'Nora',servicio:'Audit',language:'en'}).subject,/Following up/);assert.match(renderFollowup({cliente:'Nora',servicio:'Audit'}).subject,/Seguimiento/);}finally{db.close();}
});

test('HTTP preference, catalogues, localized error codes and restart projection work without a model or effect',async t=>{
 const db=memory(t);let port;const server=createServer(createApp({db,secrets:makeSecrets({mode:'memory'}),token:'synthetic-token',staticDir,getPort:()=>port}));await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${port}`,headers={'x-pyme1-token':'synthetic-token','content-type':'application/json'};
 assert.match(await(await fetch(url)).text(),/<html lang="es">/);
 const saved=await(await fetch(url+'/api/settings',{method:'POST',headers,body:JSON.stringify({language:'en'})})).json();assert.equal(saved.language,'en');assert.match(await(await fetch(url)).text(),/<html lang="en">/);
 const [en,es]=await Promise.all(['en','es'].map(async lang=>(await fetch(url+'/api/unknown',{headers:{...headers,'x-rem-language':lang}})).json()));assert.equal(en.error,'NOT_FOUND');assert.equal(es.error,'NOT_FOUND');assert.notEqual(en.message,es.message);
 const invalid=await fetch(url+'/api/settings',{method:'POST',headers,body:'{"language":"fr"}'});assert.equal(invalid.status,400);assert.match((await invalid.json()).message,/Choose Spanish or English/);
 for(const lang of ['en','es'])assert.equal((await fetch(url+'/i18n/'+lang+'.json')).status,200);
 assert.equal((await fetch(url+'/i18n/../../src/db.js')).status,404);assert.equal(db.proposals.pending().length,0);assert.equal(db.audit.list().length,0);
});

test('per-draft override reaches the isolated writer and general fusion; no business action or approval occurs',async t=>{
 const db=memory(t);db.clients.create({name:'Nora Sample',notes:'Not requested: private policy deadline 28 October'});saveSettings(db,{language:'en',local:{model:'synthetic'},privacy:'local-only'});
 const calls=[],ctx={db,secrets:makeSecrets({mode:'memory'}),settings:()=>loadSettings(db),now:()=>base,providers:{chatLocal:async(_cfg,req)=>{
  calls.push(req);if(req.system.startsWith('Eres un clasificador'))return {text:'{"intencion":{"opcion":"tarea","confianza":0.4},"multiples":{"probabilidad":1}}'};
  if(req.schema.properties.acciones)return {text:'{"respuesta":"Review these proposals.","acciones":[{"tipo":"redactar_mensaje","cliente":"Nora Sample","canal":"correo"}]}'};
  if(req.system.startsWith('Eres un redactor')){assert.match(req.system,/Redacta en español/);assert.deepEqual(Object.keys(JSON.parse(req.messages[0].content)),['cliente','canal','peticion']);assert.doesNotMatch(req.system+JSON.stringify(req.messages),/28 October|private policy/);return {text:'{"cliente":"Nora Sample","canal":"correo","asunto":"Gracias","texto":"Gracias por tu ayuda."}'};}
  return {text:'{"titulo":"Call Nora","cliente":"Nora Sample"}'};
 }}};
 const result=await askAgent(ctx,'Prepare an email for Nora thanking her and remind me to call tomorrow',{draftLanguage:'es',prefer:'local'});
 const draft=result.proposals.find(p=>p.kind==='redactar_mensaje');assert.ok(draft);assert.equal(draft.payload.idioma,'es');assert.equal(draft.payload.texto,'Gracias por tu ayuda.');assert.equal(draft.status,'pending');assert.equal(db.tasks.list().length,0);assert.deepEqual(db.audit.list(),[]);assert.ok(calls.some(r=>r.system.includes('Write the response for the professional in English')));
});

test('triage and governed local draft obey an explicit draft language without customer-record leakage or network access',async t=>{
 const db=memory(t);db.clients.create({name:'Nora Sample',notes:'private old task'});saveSettings(db,{language:'es',local:{model:'synthetic'},privacy:'local-only'});
 const ctx={db,secrets:makeSecrets({mode:'memory'}),settings:()=>loadSettings(db),now:()=>base,providers:{chatLocal:async(_cfg,req)=>{
  if(req.system.startsWith('Eres un clasificador'))return {text:'{"categoria":{"opcion":"administrativo","confianza":1},"urgencia":{"nivel":0},"responder":{"probabilidad":1}}'};
  assert.match(req.system,/inglés \(English\)/);assert.doesNotMatch(JSON.stringify(req.messages),/private old task/);return {text:'{"resumen":"Confirmación","respuesta":"Thank you for your help.","tarea":{"titulo":"","fecha":""}}'};
 }}};
 const result=await triage(ctx,{sender:'Nora Sample',channel:'correo',text:'Confirma que has recibido el mensaje',draftLanguage:'en'});assert.equal(result.proposals[0].payload.idioma,'en');assert.equal(result.proposals[0].status,'pending');
 const {draftAwos}=await import('../src/awos-drafter.js');const governed=await draftAwos({language:'es',local:{enabled:true,url:'http://127.0.0.1:11434',model:'synthetic'}},{name:'Nora Sample',notes:'private old task'},'Agradece a Nora su ayuda',{language:'en',fetcher:async()=>new Response(JSON.stringify({model_info:{architecture:'synthetic'}})),chat:async(_cfg,req)=>{assert.match(req.system,/inglés \(English\)/);assert.doesNotMatch(JSON.stringify(req.messages),/private old task/);return {text:'{"asunto":"Thank you","texto":"Thank you for your help."}'};}});assert.equal(governed.body,'Thank you for your help.');assert.deepEqual(db.audit.list(),[]);
});

// Small tree model exercises node identity, not layout or browser parsing.
class Tree {
 constructor(tagName='',text=''){this.tagName=tagName;this.nodeType=tagName?1:3;this.text=text;this.attrs=new Map();this.childNodes=[];this.parentNode=null;}
 get children(){return this.childNodes.filter(n=>n.nodeType===1);}
 get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
 setAttribute(k,v){this.attrs.set(k,v);} removeAttribute(k){this.attrs.delete(k);}hasAttribute(k){return this.attrs.has(k);}
 get firstChild(){return this.childNodes[0]??null;}get nextSibling(){return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)+1]??null;}
 insertBefore(node,before){node.parentNode=this;const index=before?this.childNodes.indexOf(before):this.childNodes.length;this.childNodes.splice(index,0,node);}
 removeChild(node){this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;}
 cloneNode(deep){const copy=new Tree(this.tagName,this.text);for(const [k,v]of this.attrs)copy.setAttribute(k,v);if(deep)for(const node of this.childNodes)copy.insertBefore(node.cloneNode(true),null);return copy;}
 get content(){return this;}get textContent(){return this.nodeType===3?this.text:this.childNodes.map(n=>n.textContent).join('');}
}
function translatedTree(label){const root=new Tree('DIV'),form=new Tree('FORM'),field=new Tree('INPUT'),button=new Tree('BUTTON');form.setAttribute('id','editor');field.setAttribute('name','draft');button.setAttribute('id','confirm');form.insertBefore(new Tree('',label+' '),null);form.insertBefore(field,null);button.insertBefore(new Tree('',label),null);form.insertBefore(button,null);root.insertBefore(form,null);return {root,form,field,button};}
test('translation patches live nodes so asynchronous error handlers retain their form and button references',async()=>{
 const old=translatedTree('Review'),next=translatedTree('Revisar');old.root.ownerDocument={createElement:()=>next.root};old.field.value='Original unsaved text';old.button.disabled=true;old.button.setAttribute('data-blocked','unconfirmed');const pending=Promise.resolve().then(()=>{old.button.disabled=false;old.form.error='synthetic real failure';});
 assert.equal(patchTranslatedHtml(old.root,'trusted catalogue markup'),true);assert.equal(old.root.children[0],old.form);assert.equal(old.form.children[0],old.field);assert.equal(old.form.children[1],old.button);assert.equal(old.field.value,'Original unsaved text');assert.equal(old.button.disabled,true);assert.equal(old.button.textContent,'Revisar');assert.equal(old.button.attrs.get('data-blocked'),'unconfirmed');await pending;assert.equal(old.root.children[0].error,'synthetic real failure');assert.equal(old.form.children[1].disabled,false);
 const foreign=translatedTree('Other');foreign.form.setAttribute('id','another-operation');old.root.ownerDocument.createElement=()=>foreign.root;assert.equal(patchTranslatedHtml(old.root,'changed business structure'),false);assert.equal(old.root.children[0],old.form);assert.equal(old.button.textContent,'Revisar');
});
