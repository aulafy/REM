// Cifras permitidas por su procedencia, sin decidir la intención del usuario.
export const numbers = (text) => String(text ?? '').match(/\d+(?:[.,]\d+)*/g) || [];
const canonical = (n) => n.replace(/^0+(?=\d)/, '');
export function allowedNumbers(request, date = '', client = null, { card = false } = {}) {
  const sources = [request, client?.phone || ''];
  if (card && client) sources.push(client.name, client.email, client.notes);
  const allowed = new Set(sources.flatMap(numbers).map(canonical));
  if (client?.phone) allowed.add(client.phone.replace(/\D/g, ''));
  for (const value of (Array.isArray(date) ? date : [date])) if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    allowed.add(canonical(value.slice(8))); allowed.add(value.slice(0, 4));
  }
  return allowed;
}
export function unexpectedNumbers(request, payload, date = '', client = null, options) {
  const allowed = allowedNumbers(request, date, client, options);
  return [...new Set(numbers(`${payload.asunto || ''} ${payload.texto || ''}`).filter((n) => !allowed.has(canonical(n))))];
}
