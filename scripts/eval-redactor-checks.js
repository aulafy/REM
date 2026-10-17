// Mismo criterio por petición aprobado en la línea base. No depende del producto.
import {dateReferences,fold} from '../src/dates.js';
import {allowedNumbers,numbers} from '../src/numbers.js';
export function augmentExamen3(row, clientPhone){
 if(!row.id.startsWith('h3-'))return row;
 const drafts=(row.result?.proposals||[]).filter(p=>p.kind==='redactar_mensaje').map(p=>p.payload);
 const contains=(p,term)=>fold(`${p.asunto||''} ${p.texto||''}`).includes(fold(term));
 const refs=dateReferences(row.text,new Date('2026-10-10T12:00:00+02:00')).filter(r=>!/^dentro de /i.test(r.expression));
 const allowed=allowedNumbers(row.text,'',null);for(const r of refs){for(const n of allowedNumbers('',r.date))allowed.add(n);}
 const checks=row.checks.filter(c=>c.name!=='sin cifras inventadas');
 checks.push({name:'sin cifras inventadas',ok:drafts.every(p=>{const matches=clientPhone.filter(c=>fold(c.name).includes(fold(p.cliente))&&p.cliente);const a=new Set(allowed);if(matches.length===1)for(const n of numbers(matches[0].phone))a.add(n);return numbers(`${p.asunto||''} ${p.texto||''}`).every(n=>a.has(n.replace(/^0+(?=\d)/,'')));})});
 for(const term of row.expected.requiredTerms||[])checks.push({name:`contenido requerido: ${term}`,ok:drafts.length>0&&drafts.every(p=>contains(p,term))});
 if(row.expected.relative)checks.push({name:'plazo relativo literal',ok:drafts.length>0&&drafts.every(p=>contains(p,row.expected.relative))});
 const groups=row.expected.temporalGroups||(row.expected.temporalAlternatives?[row.expected.temporalAlternatives]:[]);
 for(const group of groups)checks.push({name:`fecha legítima: ${group[0]}`,ok:drafts.length>0&&drafts.every(p=>group.some(term=>contains(p,term)))});
 return {...row,checks,passed:checks.every(c=>c.ok)};
}
