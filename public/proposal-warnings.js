// Aviso visible y escapado: la cifra nunca elimina el borrador ni aprueba una acción.
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function warningsHtml(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return '';
  const figures = warnings.map(esc).join(', ');
  return `<div class="prop-warn" role="note" aria-label="Numbers to review"><span>Review: the draft includes ${figures}, which ${warnings.length > 1 ? 'were' : 'was'} not in your request. Check the numbers and their source before approving.</span></div>`;
}

export function dateWarningsHtml(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return '';
  return `<div class="prop-warn" role="note" aria-label="Dates to review"><span>Review: the draft includes ${warnings.map(v=>`«${esc(v)}»`).join(', ')}, ${warnings.length===1?'a date absent':'dates absent'} from your request and its permitted equivalents. Check the date before approving.</span></div>`;
}
