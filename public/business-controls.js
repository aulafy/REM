import { t as tx } from './i18n.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function businessHtml(op, business) {
    const c = business?.contexts?.find(c => c.opId === op.opId && c.version === op.version);
    if (!c)
        return '';
    if (c.error)
        return tx("business-controls.businessHtml.could_not_load_the_opportunity.426fb9e");
    const records = business.records.filter(r => r.leadId === c.leadId), pending = records.some(r => r.stage !== 'committed');
    return tx("business-controls.businessHtml.response_and_opportunity_closure_opportunity.19dea6a", esc(({ won: tx("business-controls.businessHtml.won.acdf290"), lost: tx("business-controls.businessHtml.lost.51e1357"), new: tx("business-controls.businessHtml.new.18fdd54"), qualified: tx("business-controls.businessHtml.qualified.bfa4c0f"), proposal: tx("business-controls.businessHtml.proposal.5d42766") })[c.status] ?? c.status), esc(c.contactId), op.version, esc(c.to?.join(', ')), esc(c.subject), !pending ? tx("business-controls.businessHtml.record_client_reply_manually_pasted.b39ad48", esc(op.opId), op.version) : '', c.canClose && !pending ? tx("business-controls.businessHtml.close_opportunity_result_won_lost.68877f3", esc(op.opId), op.version) : '', records.map(r => `<li>${r.input.kind === "reply" ? tx("business-controls.businessHtml.manual_reply.3462d06") : r.input.status === 'won' ? tx("business-controls.businessHtml.closed_won.fa53eca") : tx("business-controls.businessHtml.closed_lost.166cff6")} · ${r.stage === 'committed' ? tx("business-controls.businessHtml.recorded.c7175fa") : r.stage === 'blocked' ? tx("business-controls.businessHtml.review_required.f0742e3") : tx("business-controls.businessHtml.awaiting_confirmation.d0ae0b3")} · ${esc(r.input.reason)}${r.stage === 'recorded' ? tx("business-controls.businessHtml.recover_pending_record.85d2025", esc(r.commandId)) : ''}</li>`).join(''));
}
