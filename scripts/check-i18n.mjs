import ts from '../runtime/awos/node_modules/typescript/lib/typescript.js';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function catalogProblems(en,es){
 const problems=[];
 for(const key of new Set([...Object.keys(en),...Object.keys(es)])){
  if(typeof en[key]!=='string'||typeof es[key]!=='string'){problems.push({key,error:'MISSING_TRANSLATION'});continue;}
  const slots=value=>(value.match(/⟦\d+⟧/g)||[]).sort().join('|');
  if(slots(en[key])!==slots(es[key]))problems.push({key,error:'PLACEHOLDER_MISMATCH'});
  const tags=value=>(value.match(/<[^>]*>/g)||[]).map(tag=>tag.replace(/\b(?:aria-label|title|placeholder)="[^"]*"/g,'')).join('|');
  if(tags(en[key])!==tags(es[key]))problems.push({key,error:'MARKUP_CONTRACT_MISMATCH'});
 }
 return problems;
}
const wireCalls=new Set(['querySelector','querySelectorAll','getElementById','closest','getAttribute','setAttribute','removeAttribute','addEventListener','removeEventListener','matchMedia','replace','replaceAll','split','join','normalize','matches','api','fetch','CustomEvent','$','$$']);
const brands=new Set(['REM','R','WhatsApp','Telegram','iMessage','Anthropic','OpenAI','API A2A','Webhook','App','Europe/Madrid']);
export function fixedCopy(source,file='source.js'){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),problems=[];
 function visit(node){
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateExpression(node)){
   const text=ts.isTemplateExpression(node)?node.head.text+node.templateSpans.map(span=>' ⟦value⟧ '+span.literal.text).join(''):node.text;
   let skip=false;
   if((ts.isBinaryExpression(node.parent)&&/\.(?:key|className)$/.test(node.parent.left.getText()))||ts.isExpressionStatement(node.parent)||ts.isImportDeclaration(node.parent)||ts.isPropertyAssignment(node.parent)&&(node.parent.name===node||['source','kind','type','route','icon','renderer','method','status'].includes(node.parent.name.getText().replace(/["']/g,''))))skip=true;
   for(let p=node.parent;!skip&&p;p=p.parent){
    if(ts.isFunctionLike(p))break;
    if(ts.isCallExpression(p)){
     const name=p.expression.getText().split('.').pop();
     if(['t','tx','translate'].includes(name))skip=true;
     else if(wireCalls.has(name)&&!(name==='setAttribute'&&p.arguments[1]===node&&['aria-label','title','placeholder'].includes(p.arguments[0]?.text)))skip=true;
     break;
    }
   }
   if(ts.isTemplateExpression(node)&&/^⟦value⟧-⟦value⟧-⟦value⟧T⟦value⟧:⟦value⟧(?::00Z)?$/.test(text.replace(/ /g,'')))skip=true;
   const directUi=ts.isBinaryExpression(node.parent)&&/\.(?:textContent|innerHTML|title|placeholder|ariaLabel)$/.test(node.parent.left.getText());
   const html=/<[a-z][^>]*>/i.test(text),plain=text.replace(/<[^>]*>/g,' ').replace(/⟦[^⟧]*⟧/g,'').trim();
   const technical=/^(?:https?:|sms:|mailto:|\/api\/|[A-Z][A-Z0-9_:.-]*$|#[\w-]+$|--[\w-]+$)/.test(text)||/T\d{2}:\d{2}/.test(text)||/^[\w-]+(?:\.[\w-]+)+$/.test(text);
   if(!skip&&!brands.has(text)&&!technical&&/[A-Za-zÁÉÍÓÚáéíóúñ]/.test(plain)&&(directUi||html||/\s/.test(plain)||/^[A-ZÁÉÍÓÚ]/.test(plain))){
    const pos=ast.getLineAndCharacterOfPosition(node.getStart());problems.push({file,line:pos.line+1,text});
   }
  }
  ts.forEachChild(node,visit);
 }visit(ast);return problems;
}
export function translationKeys(source,file='source.js'){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),keys=[];
 function visit(node){if(ts.isCallExpression(node)){
  const name=node.expression.getText();const arg=node.arguments[name==='translate'?1:0];
  if(['t','tx','translate'].includes(name)&&arg&&ts.isStringLiteral(arg))keys.push(arg.text);
 }ts.forEachChild(node,visit);}visit(ast);return keys;
}
export function staticCopy(html){
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<svg\b[\s\S]*?<\/svg>/g,'').replace(/{{i18n:[\w.-]+}}/g,'');
 const problems=[];
 for(const match of clean.matchAll(/>([^<>]+)</g))if(/[A-Za-zÁÉÍÓÚáéíóúñ]/.test(match[1]))problems.push(match[1].trim());
 for(const match of clean.matchAll(/(?<![\w-])(?:aria-label|title|placeholder)="([^"]+)"/g))if(/[A-Za-zÁÉÍÓÚáéíóúñ]/.test(match[1]))problems.push(match[1]);
 return problems;
}
export function checkI18n(root=resolve(fileURLToPath(new URL('..',import.meta.url)))){
 const en=JSON.parse(readFileSync(resolve(root,'public/i18n/en.json'))),es=JSON.parse(readFileSync(resolve(root,'public/i18n/es.json')));
 const problems=catalogProblems(en,es);
 for(const name of readdirSync(resolve(root,'public')).filter(name=>name.endsWith('.js'))){const source=readFileSync(resolve(root,'public',name),'utf8');problems.push(...fixedCopy(source,name));for(const key of translationKeys(source,name))if(!Object.hasOwn(en,key)||!Object.hasOwn(es,key))problems.push({file:name,key,error:'REFERENCED_KEY_MISSING'});}
 const html=readFileSync(resolve(root,'public/index.html'),'utf8');
 for(const match of html.matchAll(/{{i18n:([\w.-]+)}}/g))if(!Object.hasOwn(en,match[1])||!Object.hasOwn(es,match[1]))problems.push({file:'index.html',key:match[1],error:'REFERENCED_KEY_MISSING'});
 for(const text of staticCopy(html))problems.push({file:'index.html',text});
 return {keys:Object.keys(en).length,problems};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=checkI18n();console.log(JSON.stringify(result,null,2));if(result.problems.length)process.exitCode=1;
}
