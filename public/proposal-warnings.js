import { t as tx } from './i18n.js';
// Aviso visible y escapado: la cifra nunca elimina el borrador ni aprueba una acción.
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function warningsHtml(warnings) {
    if (!Array.isArray(warnings) || !warnings.length)
        return '';
    const figures = warnings.map(esc).join(', ');
    return tx("proposal-warnings.warningsHtml.review_the_draft_includes_which.4b60bcd", figures, warnings.length > 1 ? tx("proposal-warnings.warningsHtml.were.910adfb") : tx("proposal-warnings.warningsHtml.was.b63b99f"));
}
export function dateWarningsHtml(warnings) {
    if (!Array.isArray(warnings) || !warnings.length)
        return '';
    return tx("proposal-warnings.dateWarningsHtml.review_the_draft_includes_from.25d1b43", warnings.map(v => `«${esc(v)}»`).join(', '), warnings.length === 1 ? tx("proposal-warnings.dateWarningsHtml.a_date_absent.fadf4fc") : tx("proposal-warnings.dateWarningsHtml.dates_absent.06f962c"));
}
