// Calendario local compartido por el agente y la evaluación.
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// ---------- Fechas dichas con palabras («el martes», «mañana», «el día 20») ----------
// Los modelos pequeños se equivocan a menudo con esto; se resuelve aquí sin IA.
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
export const fold = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const EN_WEEKDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
export function businessDate(base=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(base);
 const value=type=>parts.find(p=>p.type===type).value;
 return new Date(Number(value('year')),Number(value('month'))-1,Number(value('day')),12);
}
export function resolveDate(text, base = new Date()) {
  base=businessDate(base);
  const t = fold(text);
  const at = (days) => { const d = new Date(base); d.setDate(d.getDate() + days); return isoLocal(d); };
  const found = [];
  if (/\bpasado manana\b/.test(t)) found.push(at(2));
  else if (/(^|[^a-z])manana\b/.test(t.replace(/\b(por|de|a|esta|la) (la )?manana\b/g, ''))) found.push(at(1));
  if (/\b(?:hoy|today)\b/.test(t)) found.push(at(0));
  if (/\bday after tomorrow\b/.test(t)) found.push(at(2));
  else if (/\btomorrow\b/.test(t)) found.push(at(1));
  const englishPeriod=t.match(/\bin (\d{1,2}) days?\b/);
  if(englishPeriod)found.push(at(Number(englishPeriod[1])));
  for(const m of t.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)){
   let diff=(EN_WEEKDAYS.indexOf(m[1])-base.getDay()+7)%7;if(!diff)diff=7;found.push(at(diff));
  }
  const dentro = t.match(/\bdentro de (\d{1,2}) dias?\b/);
  if (dentro) found.push(at(Number(dentro[1])));
  for (const m of t.matchAll(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/g)) {
    let diff = (WEEKDAYS.indexOf(m[1]) - base.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    found.push(at(diff));
  }
  const dia = t.match(/\b(?:el )?dia (\d{1,2})\b/);
  if (dia) {
    const n = Number(dia[1]);
    if (n >= 1 && n <= 31) {
      const d = new Date(base.getFullYear(), base.getMonth(), n);
      if (n < base.getDate()) d.setMonth(d.getMonth() + 1);
      if (d.getDate() === n) found.push(isoLocal(d));
    }
  }
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : '';
}


export function taskTitle(title, base = new Date()) {
  const expressions = /(?:\b(?:el |este |proximo |próximo )?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\b|\bpasado ma[nñ]ana\b|\bma[nñ]ana\b|\bhoy\b|\b(?:el )?d[ií]a \d{1,2}\b|\bdentro de \d{1,2} d[ií]as?\b|\b(?:on |this |next )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(?:day after tomorrow|tomorrow|today|in \d{1,2} days?)\b)/gi;
  let text = String(title || '').replace(expressions, (part, offset, whole) => {
    if (/^ma[nñ]ana$/i.test(part) && /(?:por|de|a|esta|la) (?:la )?$/i.test(whole.slice(0, offset))) return part;
    return resolveDate(part, base) ? '' : part;
  }).replace(/\s+/g, ' ').replace(/\s*[,;:]\s*$/g, '').trim();
  return text ? text[0].toLocaleUpperCase('es') + text.slice(1) : '';
}

// Equivalencias por expresión: no asignamos una fecha global si hay varias distintas.
export function dateReferences(text, base = new Date()) {
  const input = String(text || ''), folded = fold(input), references = [];
  const expressions = /\b(?:pasado manana|dentro de \d{1,2} dias?|(?:el )?dia \d{1,2}|manana|hoy|domingo|lunes|martes|miercoles|jueves|viernes|sabado|day after tomorrow|tomorrow|today|in \d{1,2} days?|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g;
  for (const match of folded.matchAll(expressions)) {
    if (match[0] === 'manana' && /(?:por|de|a|esta|la) (?:la )?$/.test(folded.slice(0, match.index))) continue;
    const date = resolveDate(match[0], base);
    if (!date) continue;
    const human = new Date(`${date}T12:00:00Z`).toLocaleDateString(/[a-z]/.test(match[0]) && /(?:today|tomorrow|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(match[0])?'en-GB':'es-ES', { timeZone:'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    references.push({ expression: input.slice(match.index, match.index + match[0].length), date, human });
  }
  return references;
}
export function datePrompt(text, base = new Date()) {
  const refs = dateReferences(text, base);
  return refs.length ? `Fechas resueltas de esta petición (usa estas equivalencias exactas, no recalcules): ${refs.map(r => `${r.expression} = ${r.human} (${r.date})`).join('; ')}. Una fecha dentro del texto para el destinatario no solicita una tarea.` : '';
}
