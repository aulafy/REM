// Política del borrador, separada del calendario de tareas y de los criterios de evaluación.
import {dateReferences,fold} from './dates.js';
const quantity='(?:\\d{1,4}|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|treinta)';
export function relativePeriods(request){
 const input=String(request||''), re=new RegExp(`\\b(?:(?:dentro de|en|al cabo de|durante)\\s+)?${quantity}\\s+(?:dias?|semanas?|mes(?:es)?|anos?|horas?)\\b`,'g');
 return [...fold(input).matchAll(re)].map(m=>({expression:input.slice(m.index,m.index+m[0].length),start:m.index,end:m.index+m[0].length}));
}
export function draftingDateReferences(request,base){
 const periods=relativePeriods(request), literals=absoluteDates(request,base).filter(d=>!d.inferred), text=fold(request);
 let cursor=0;
 return dateReferences(request,base).filter(r=>{
  const at=text.indexOf(fold(r.expression),cursor);cursor=at+r.expression.length;
  if(periods.some(p=>fold(p.expression).includes(fold(r.expression))))return false;
  // Un weekday que ya acompaña una fecha literal no debe recalcularla.
  if(/^(domingo|lunes|martes|miercoles|jueves|viernes|sabado)$/.test(fold(r.expression)) && literals.some(d=>d.start>=at&&d.start<=cursor+4))return false;
  return true;
 });
}
export function draftingDatesPrompt(request,base){
 const refs=draftingDateReferences(request,base),periods=relativePeriods(request);
 const lines=[];
 if(refs.length)lines.push(`Fechas resueltas solo de esta petición: ${refs.map(r=>`${r.expression} = ${r.human} (${r.date})`).join('; ')}. No recalcules ni añadas otra fecha.`);
 if(periods.length)lines.push(`Plazos relativos literales: ${periods.map(p=>JSON.stringify(p.expression)).join('; ')}. Conserva cada expresión tal cual en el borrador; no la conviertas en fecha absoluta, no añadas una fecha de inicio ni "a partir de hoy" si no lo pide la persona.`);
 lines.push('Conserva cualquier plazo relativo literalmente, aunque esté escrito con palabras; no lo conviertas en una fecha ni cambies su unidad. Si la petición no expresa una fecha, no añadas ninguna. Una fecha en el contenido de un mensaje no pide crear una tarea.');
 return lines.join('\n');
}
const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const SHORT=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const dayWords=['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis','veintisiete','veintiocho','veintinueve','treinta','treinta y uno'];
const dayPattern=`(?:${dayWords.slice(1).sort((a,b)=>b.length-a.length).join('|')}|\\d{1,2})`;
const number = word => /^\d+$/.test(word)?Number(word):dayWords.indexOf(word);
const iso=(y,m,d)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
export function absoluteDates(text,base=new Date()){
 const input=String(text||''),t=fold(input),found=[];
 const add=(m,y,month,day,inferred=false)=>{
  if(found.some(d=>m.index<d.end && m.index+m[0].length>d.start))return;
  found.push({text:input.slice(m.index,m.index+m[0].length),date:iso(y,month,day),start:m.index,end:m.index+m[0].length,inferred});
 };
 for(const m of t.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g))add(m,Number(m[1]),Number(m[2]),Number(m[3]));
 for(const m of t.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2}|\d{2})\b/g))add(m,m[3].length===2?2000+Number(m[3]):Number(m[3]),Number(m[2]),Number(m[1]));
 for(const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?![\d/])\b/g)) if(Number(m[1])>=1&&Number(m[1])<=31&&Number(m[2])>=1&&Number(m[2])<=12)add(m,base.getFullYear(),Number(m[2]),Number(m[1]));
 const monthPattern=[...MONTHS,'setiembre',...SHORT].join('|');
 const wordsRe=new RegExp(`\\b(${dayPattern})\\s+(?:de\\s+)?(${monthPattern})\\b(?:\\.?\\s+(?:de\\s+)?(20\\d{2}))?`,'g');
 for(const m of t.matchAll(wordsRe)){
  const month=m[2]==='setiembre'?9:MONTHS.includes(m[2])?MONTHS.indexOf(m[2])+1:SHORT.indexOf(m[2])+1;
  add(m,m[3]?Number(m[3]):base.getFullYear(),month,number(m[1]));
 }
 const weekRe=new RegExp(`\\b(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado),?\\s+(${dayPattern})\\b`,'g');
 for(const m of t.matchAll(weekRe))add(m,base.getFullYear(),base.getMonth()+1,number(m[1]),true);
 const dayRe=new RegExp(`\\b(?:el\\s+)?dia\\s+(${dayPattern})\\b`,'g');
 for(const m of t.matchAll(dayRe))add(m,base.getFullYear(),base.getMonth()+1,number(m[1]),true);
 return found;
}
export function unexpectedDates(request,payload,base=new Date()){
 const literal=absoluteDates(request,base), allowed=new Set(literal.filter(d=>!d.inferred).map(d=>d.date));
 const literalText=new Set(literal.map(d=>fold(d.text)));
 for(const r of draftingDateReferences(request,base))allowed.add(r.date);
 const dates=absoluteDates(`${payload.asunto||''}\n${payload.texto||''}`,base);
 const seen=new Set();
 return dates.filter(d=>!literalText.has(fold(d.text))&&!allowed.has(d.date)&&!seen.has(d.date)&&(seen.add(d.date),true)).map(d=>d.text);
}
