import {resolveLanguage,validLanguage} from './language.js';
import {randomUUID} from 'node:crypto';

export const PROPOSAL_VARIABLES=Object.freeze({
 cliente:{type:'text',max:120,required:true},servicio:{type:'text',max:200,required:true},
 importe:{type:'money',max:24,required:true},plazo:{type:'text-or-date',max:120,required:true},
 validez:{type:'text-or-date',max:120,required:true},condiciones:{type:'text',max:2000,required:true},
});
const allowed=new Set(Object.keys(PROPOSAL_VARIABLES));
const placeholders=/{{\s*([a-zA-Z0-9_]+)\s*}}/g;
export const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=(message)=>{const e=Error(message);e.code='PROPOSAL_TEMPLATE_INVALID';throw e;};
const text=(value,name,max,required=true)=>{if(typeof value!=='string')fail(`${name} debe ser texto.`);const v=value.trim();if(required&&!v)fail(`${name} es obligatorio.`);if(v.length>max)fail(`${name} supera ${max} caracteres.`);return v;};
const scan=value=>{const names=[];for(const match of value.matchAll(placeholders)){if(!allowed.has(match[1]))fail(`Variable no permitida: ${match[1]}.`);names.push(match[1]);}if(/{{|}}/.test(value.replace(placeholders,'')))fail('Hay una variable de plantilla incompleta.');return names;};
export function validateTemplate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Plantilla no válida.');
 if(input.language!==undefined&&!validLanguage(input.language))fail('Elige español o inglés.');
 const out={...(input.language?{language:input.language}:{}),nombre:text(input.nombre,'El nombre',120),asunto:text(input.asunto,'El asunto',200),cuerpo:text(input.cuerpo,'El cuerpo',6000)};
 scan(out.asunto);scan(out.cuerpo);return out;
}
function valueFor(name,value){const rule=PROPOSAL_VARIABLES[name];if(name==='importe'){
 const raw=typeof value==='number'?value:typeof value==='string'&&/^\d{1,9}(?:[.,]\d{1,2})?(?: EUR)?$/.test(value.trim())?Number(value.trim().replace(/ EUR$/,'').replace(',','.')):NaN;
 if(!Number.isFinite(raw)||raw<0||raw>999999999.99)fail('importe debe ser numérico, positivo y con un máximo de 2 decimales.');
 return `${raw.toFixed(2)} EUR`;
 }
 const out=text(value,name,rule.max,rule.required);if(rule.type==='text-or-date'&&/^\d{4}-\d{2}-\d{2}$/.test(out)&&Number.isNaN(Date.parse(out+'T00:00:00Z')))fail(`${name} no es una fecha válida.`);return out;
}
export function validateVariables(input){if(!input||typeof input!=='object'||Array.isArray(input))fail('Variables no válidas.');const keys=Object.keys(input);if(keys.some(k=>!allowed.has(k)))fail('La propuesta contiene variables no permitidas.');return Object.fromEntries(Object.keys(PROPOSAL_VARIABLES).map(k=>[k,valueFor(k,input[k])]));}
export function renderProposal(template,input,{language}={}){if(language!==undefined&&!validLanguage(language))fail('Elige español o inglés.');if(language&&resolveLanguage(template.language)!==language)fail('La plantilla no está en el idioma elegido. Crea una versión en ese idioma.');const variables=validateVariables(input),used=new Set([...template.asunto.matchAll(placeholders),...template.cuerpo.matchAll(placeholders)].map(m=>m[1]));const missing=[...used].filter(k=>!variables[k]);if(missing.length)fail(`Falta valor para ${missing.join(', ')}.`);const replace=(_m,name)=>name==='importe'&&language?new Intl.NumberFormat(language==='en'?'en-GB':'es-ES',{style:'currency',currency:'EUR'}).format(Number(variables[name].replace(/ EUR$/,''))):variables[name];return {subject:template.asunto.replace(placeholders,replace),body:template.cuerpo.replace(placeholders,replace),variables,...(language?{language}:{})};}
export function previewProposalHtml(rendered){return `<h4>${escapeHtml(rendered.subject)}</h4><pre class="awos-body">${escapeHtml(rendered.body)}</pre>`;}

export function renderFollowup({cliente,servicio,nota='',language='es'}){
 const name=text(cliente,'cliente',120),work=text(servicio,'servicio',200),note=text(nota,'nota',1000,false);
 if(resolveLanguage(language)==='en')return {subject:`Following up on your proposal: ${work}`,body:[`Hello ${name},`,'',`I wanted to follow up on the proposal for ${work}.`,note?`Follow-up note: ${note}`:'','','I look forward to your feedback.'].filter((line,index,lines)=>line||lines[index-1]!=='' ).join('\n')};
 return {subject:`Seguimiento de la propuesta: ${work}`,body:[`Hola ${name},`,'',`Quería hacer seguimiento de la propuesta sobre ${work}.`,note?`Nota de seguimiento: ${note}`:'', '', 'Quedo pendiente de tus comentarios.'].filter((line,index,lines)=>line||lines[index-1]!=='' ).join('\n')};
}

export function createProposalTemplates(db){
 db.run(`CREATE TABLE IF NOT EXISTS proposal_templates (id TEXT NOT NULL, nombre TEXT NOT NULL, asunto TEXT NOT NULL, cuerpo TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(id,version))`);
 const columns=new Set(db.all('PRAGMA table_info(proposal_templates)').map(c=>c.name));if(!columns.has('language'))db.run('ALTER TABLE proposal_templates ADD COLUMN language TEXT');
 const row=r=>{if(!r)return r;const {language,...rest}=r;return {...rest,...(language?{language}:{}),id:String(r.id),version:Number(r.version)};},get=(id,version)=>row(db.all('SELECT * FROM proposal_templates WHERE id=? AND version=?',id,version)[0]);
 const latest=id=>row(db.all('SELECT * FROM proposal_templates WHERE id=? ORDER BY version DESC LIMIT 1',id)[0]);
 return {
  list:()=>db.all('SELECT p.* FROM proposal_templates p JOIN (SELECT id,MAX(version) version FROM proposal_templates GROUP BY id) x ON x.id=p.id AND x.version=p.version ORDER BY p.nombre COLLATE NOCASE').map(row),
  history:id=>db.all('SELECT * FROM proposal_templates WHERE id=? ORDER BY version DESC',id).map(row),get,
  create(input,{id=randomUUID(),at=new Date().toISOString()}={}){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))fail('Identificador de plantilla no válido.');const v=validateTemplate(input);db.run('INSERT INTO proposal_templates (id,nombre,asunto,cuerpo,version,created_at,updated_at,language) VALUES (?,?,?,?,1,?,?,?)',id,v.nombre,v.asunto,v.cuerpo,at,at,v.language??null);return get(id,1);},
  update(id,input,{at=new Date().toISOString()}={}){const old=latest(id);if(!old)return null;const v=validateTemplate(input),version=old.version+1;db.run('INSERT INTO proposal_templates (id,nombre,asunto,cuerpo,version,created_at,updated_at,language) VALUES (?,?,?,?,?,?,?,?)',id,v.nombre,v.asunto,v.cuerpo,version,old.created_at,at,v.language??old.language??null);return get(id,version);},
  remove(id){return db.run('DELETE FROM proposal_templates WHERE id=?',id).changes>0;},
 };
}
