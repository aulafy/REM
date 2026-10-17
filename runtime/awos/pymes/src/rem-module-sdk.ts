/** Reviewed process modules. Data only: no code, SQL, URLs, credentials or dispatch authority. */
import {CapsuleError,capsuleRecord,capsuleId,capsuleText,capsuleRevision} from './capsule-sdk.js';
export const REM_ACTIONS = {
 'intake.messages': ['crm.read'], 'intake.preview':['crm.read'], 'intake.capture':['crm.read','crm.write'], 'intake.resume':['crm.read','crm.write'],
 'proposal.prepare':['crm.read','draft.prepare','review.request'], 'proposal.decision':['review.decide'], 'proposal.resume':['crm.read','draft.prepare','review.request'], 'proposal.draft':['crm.read','draft.prepare'], 'proposal.suggestion':['draft.prepare'],
 'followup.schedule':['followup.manage'], 'followup.prepare':['followup.manage','draft.prepare','review.request'], 'followup.dismiss':['followup.manage'],
 'business.record':['crm.read','crm.write'], 'business.resume':['crm.read','crm.write'],
} as const;
export type RemAction = keyof typeof REM_ACTIONS;
export type RemCapability = typeof REM_ACTIONS[RemAction][number];
export const REM_KINDS = {requests:['intake.messages','intake.preview','intake.capture','intake.resume'],proposals:['proposal.prepare','proposal.decision','proposal.resume','proposal.draft','proposal.suggestion'],followups:['followup.schedule','followup.prepare','followup.dismiss','proposal.decision','proposal.resume'],closure:['business.record','business.resume','intake.messages']} as const;
export type RemKind = keyof typeof REM_KINDS;
export interface RemModuleConfig {title:string;subtitle:string}
export interface RemModuleManifest {id:string;version:string;sdkVersion:2;name:string;description:string;author:string;license:'MIT';renderer:'rem.process';kind:RemKind;actions:RemAction[];capabilities:RemCapability[];defaults:RemModuleConfig}
export interface RemModuleInstallation {id:string;version:string;sdkVersion:2;enabled:boolean;grants:RemCapability[];config:RemModuleConfig;updatedAt:number}
export interface RemModuleCommand {commandId:string;expectedRevision:number;sdkVersion:2;capsuleId:string;version:string;enabled:boolean;grants:RemCapability[];config:RemModuleConfig}
const invalid=():never=>{throw new CapsuleError('CAPSULE_INVALID_INPUT');};
const keys=(v:Record<string,unknown>,k:string[])=>{if(Object.keys(v).sort().join(',')!==k.sort().join(','))invalid();};
const version=(v:unknown)=>{const t=capsuleText(v,40);if(!/^\d+\.\d+\.\d+$/.test(t))invalid();return t;};
export function moduleConfig(raw:unknown):RemModuleConfig{const r=capsuleRecord(raw);keys(r,['title','subtitle']);return {title:capsuleText(r.title,64),subtitle:capsuleText(r.subtitle,160)};}
export function moduleGrants(raw:unknown):RemCapability[]{if(!Array.isArray(raw)||!raw.length||raw.length>8||raw.some(v=>typeof v!=='string'||!Object.values(REM_ACTIONS).flat().includes(v as never))||new Set(raw).size!==raw.length)invalid();return [...raw as RemCapability[]].sort();}
export function defineRemModule(raw:unknown):RemModuleManifest{
 const r=capsuleRecord(raw);keys(r,['id','version','sdkVersion','name','description','author','license','renderer','kind','actions','capabilities','defaults']);
 if(r.sdkVersion!==2)throw new CapsuleError('CAPSULE_SDK_INCOMPATIBLE');
 if(r.license!=='MIT'||r.renderer!=='rem.process'||typeof r.kind!=='string'||!Object.hasOwn(REM_KINDS,r.kind)||!Array.isArray(r.actions)||!r.actions.length||new Set(r.actions).size!==r.actions.length)invalid();
 const kind=r.kind as RemKind,actions=r.actions as RemAction[];if(actions.some(a=>!REM_KINDS[kind].includes(a as never)))invalid();
 const capabilities=moduleGrants(r.capabilities),required=[...new Set(actions.flatMap(a=>[...REM_ACTIONS[a]]))].sort();if(JSON.stringify(capabilities)!==JSON.stringify(required))invalid();
 return {id:capsuleId(r.id),version:version(r.version),sdkVersion:2,name:capsuleText(r.name,80),description:capsuleText(r.description,500),author:capsuleText(r.author),license:'MIT',renderer:'rem.process',kind,actions:[...actions],capabilities,defaults:moduleConfig(r.defaults)};
}
export function parseRemModuleCommand(raw:unknown):RemModuleCommand{const r=capsuleRecord(raw);keys(r,['commandId','expectedRevision','sdkVersion','capsuleId','version','enabled','grants','config']);const commandId=capsuleText(r.commandId);if(!/^[a-zA-Z0-9_-]+$/.test(commandId)||r.sdkVersion!==2||typeof r.enabled!=='boolean')invalid();return {commandId,expectedRevision:capsuleRevision(r.expectedRevision),sdkVersion:2,capsuleId:capsuleId(r.capsuleId),version:version(r.version),enabled:r.enabled as boolean,grants:moduleGrants(r.grants),config:moduleConfig(r.config)};}
const data:[RemKind,string,string][]=[['requests','Solicitudes','Cada conversación, un siguiente paso.'],['proposals','Propuestas','De una buena idea a una propuesta clara.'],['followups','Seguimientos','Que ninguna oportunidad se quede atrás.'],['closure','Respuestas y cierre','Una historia completa para cada oportunidad.']];
export const remModules:RemModuleManifest[]=data.map(([kind,name,subtitle])=>{const actions=[...REM_KINDS[kind]];return defineRemModule({id:'rem.'+kind,version:'1.0.0',sdkVersion:2,name,description:subtitle,author:'REM',license:'MIT',renderer:'rem.process',kind,actions,capabilities:[...new Set(actions.flatMap(a=>[...REM_ACTIONS[a]]))],defaults:{title:name,subtitle}});});
export interface RemModuleCatalog {tenantId:string;ownerId:string;revision:number;items:{manifest:RemModuleManifest;installation:RemModuleInstallation|null}[];audit:{commandId:string;capsuleId:string;revision:number;actor:string;at:number;enabled:boolean;version:string}[]}
