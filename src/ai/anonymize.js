// Sustituye datos personales por marcas antes de enviar texto a una IA externa,
// y las devuelve a su valor original en la respuesta.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeAnonymizer(knownNames = []) {
  const byKey = new Map();   // "TIPO:valor en minúsculas" -> marca
  const byToken = new Map(); // marca -> valor original
  const counters = {};

  const token = (kind, value) => {
    const key = `${kind}:${value.toLowerCase()}`;
    if (byKey.has(key)) return byKey.get(key);
    counters[kind] = (counters[kind] || 0) + 1;
    const t = `[${kind}_${counters[kind]}]`;
    byKey.set(key, t); byToken.set(t, value);
    return t;
  };

  // Nombres completos y, si no se repiten entre clientes, también el nombre de pila.
  const names = new Set();
  const firsts = new Map();
  for (const n of knownNames.map((x) => String(x || '').trim()).filter((x) => x.length >= 3)) {
    names.add(n);
    const first = n.split(/\s+/)[0];
    if (first.length >= 3 && first !== n) firsts.set(first.toLowerCase(), firsts.has(first.toLowerCase()) ? null : first);
  }
  for (const f of firsts.values()) if (f) names.add(f);
  const nameList = [...names].sort((a, b) => b.length - a.length);

  function anonymize(text) {
    if (!text) return text;
    let out = String(text);
    out = out.replace(/\bES\d{2}(?:[ ]?\d{4}){5}\b/gi, (m) => token('IBAN', m));
    out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => token('EMAIL', m));
    out = out.replace(/(?:\+34[\s-]?)?(?<![\d\w])[6789]\d{2}[\s-]?\d{3}[\s-]?\d{3}(?!\d)/g, (m) => token('TEL', m));
    out = out.replace(/(?<![\w])(?:\d{8}|[XYZ]\d{7})[A-HJ-NP-TV-Z](?![\w])/gi, (m) => token('DNI', m));
    for (const n of nameList) {
      out = out.replace(new RegExp(`(?<![\\p{L}\\[_])${escapeRe(n)}(?![\\p{L}])`, 'giu'), (m) => token('NOMBRE', m));
    }
    return out;
  }

  function restore(text) {
    if (!text) return text;
    return String(text).replace(/\[(NOMBRE|EMAIL|TEL|DNI|IBAN)_\d+\]/g, (t) => byToken.get(t) ?? t);
  }

  return { anonymize, restore, get count() { return byToken.size; } };
}
