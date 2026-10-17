// Extrae el primer objeto JSON válido de la respuesta de un modelo.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : null; } catch { /* sigue */ }
  const start = t.indexOf('{');
  if (start < 0) return null;
  // Busca el cierre que equilibra las llaves, respetando cadenas.
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
