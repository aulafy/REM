import {currentUiMessage} from './i18n.js';
import { bindValue, localized } from './i18n.js';
import { t as tx } from './i18n.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function intakeCards(data) {
    if (!data || data.enabled !== true || !Array.isArray(data.messages) || !Array.isArray(data.intakes) || !Array.isArray(data.contacts))
        throw Error(tx("intake-panel.intakeCards.unrecognized_request_state.c7dcf09"));
    return data.messages.map(m => { const linked = data.intakes.find(i => i.messageId === m.id && i.stage === 'linked'), pending = data.intakes.find(i => i.messageId === m.id && i.stage === 'recorded'), contact = linked && data.contacts.find(c => c.id === linked.contactId); return tx("intake-panel.intakeCards.manual_record_not_evidence_of.84053a9", esc(m.sender || tx("intake-panel.intakeCards.no_sender.c0263cd")), esc(m.channel), esc(m.text), linked ? tx("intake-panel.intakeCards.linked_to_awos_crm_request.2ac0fed", contact ? tx("intake-panel.intakeCards.prepare_proposal_for.7dea73b", esc(contact.id), esc(linked.commandId), esc(contact.name)) : tx("intake-panel.intakeCards.no_unique_fictional_email_is.91706bb")) : pending ? tx("intake-panel.intakeCards.capture_awaiting_confirmation_do_not.6160df9", esc(pending.commandId)) : tx("intake-panel.intakeCards.review_contact_in_awos.37a70c6", m.id)); }).join('') || tx("intake-panel.intakeCards.no_saved_requests_yet_paste.75d18bd");
}
export function intakePreviewHtml(p) {
    if (!p || !Array.isArray(p.matches) || typeof p.previewHash !== 'string')
        throw Error(tx("intake-panel.intakePreviewHtml.unrecognized_match_result.a2f3239"));
    const active = p.matches.filter(c => c.status === 'active');
    return tx("intake-panel.intakePreviewHtml.this_records_or_links_a.118fac9", p.matches.length ? tx("intake-panel.intakePreviewHtml.email_or_phone_matches_exist.ad98df3", active.length ? tx("intake-panel.intakePreviewHtml.crm_contact.88fe483", active.length > 1 ? tx("intake-panel.intakePreviewHtml.select_a_match.3354680") : '', active.map(c => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.emails.join(', ') || tx("intake-panel.intakePreviewHtml.no_email.eb249c0"))} · ${esc(c.phone)}</option>`).join('')) : tx("intake-panel.intakePreviewHtml.only_archived_contacts_match_review.7cb8b6f")) : tx("intake-panel.intakePreviewHtml.no_matches_in_the_complete.af8c2c5"), p.matches.length && !active.length ? '' : `<button type="submit">${p.matches.length ? tx("intake-panel.intakePreviewHtml.confirm_contact_link.d71b2da") : tx("intake-panel.intakePreviewHtml.create_prospect_contact_in_awos.1781284")}</button>`);
}
export function mountIntakes({ api, document: doc = document }) {
    const root = doc.getElementById('intake-panel');
    if (!root)
        return;
    bindValue(root, "innerHTML", () => tx("intake-panel.mountIntakes.awos_requests_and_contacts_synthetic.73aea3b"));
    const status = root.querySelector('[data-intake-status]'), list = root.querySelector('[data-intake-list]'), editor = root.querySelector('[data-intake-editor]');
    let data, selected = null, preview = null, busy = false, pendingPaste = null, pendingCapture = null;
    const message = t => { bindValue(status, "textContent", () => currentUiMessage(t)); status.focus({ preventScroll: true }); };
    async function refresh() {
        try {
            const next = await api('/api/awos/intakes');
            root.hidden = !next.enabled;
            if (!next.enabled)
                return;
            const html = intakeCards(next);
            data = next;
            bindValue(list, "innerHTML", () => html);
        }
        catch (e) {
            root.hidden = false;
            data = null;
            bindValue(list, "innerHTML", () => '');
            bindValue(editor, "innerHTML", () => '');
            message(tx("intake-panel.refresh.cannot_confirm_crm_state.0b2930d") + e.message);
            throw e;
        }
    }
    async function run(fn) {
        if (busy)
            return;
        busy = true;
        root.querySelectorAll('button,input,textarea,select').forEach(b => b.disabled = true);
        try {
            await fn();
        }
        catch (e) {
            message(tx("intake-panel.run.operation_unconfirmed.2b417a0") + e.message);
            if (['AWOS_INTAKE_CRM_CHANGED', 'AWOS_INTAKE_REVIEW_REQUIRED'].includes(e.code)) {
                preview = null;
                pendingCapture = null;
                const box = editor.querySelector('[data-intake-preview]');
                if (box)
                    bindValue(box, "innerHTML", () => '');
            }
            try {
                await refresh();
            }
            catch { }
        }
        finally {
            busy = false;
            root.querySelectorAll('button,input,textarea,select').forEach(b => b.disabled = false);
        }
    }
    function select(id) {
        selected = data?.messages.find(m => m.id === Number(id));
        preview = null;
        pendingCapture = null;
        if (!selected) {
            message(tx("intake-panel.select.the_request_is_no_longer.00a0190"));
            return;
        }
        bindValue(editor, "innerHTML", () => tx("intake-panel.select.review_request_contact_name_fictional.5afc22c", esc(selected.text), esc(/^[^\s@]+@example\.test$/i.test(selected.sender) ? selected.sender : '')));
        editor.querySelector('[name=name]').focus();
    }
    root.addEventListener('input', e => {
        if (e.target.closest('[data-intake-check]')) {
            preview = null;
            pendingCapture = null;
            bindValue(editor.querySelector('[data-intake-preview]'), "innerHTML", () => '');
        }
    });
    root.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b)
            return;
        if (b.hasAttribute('data-intake-refresh'))
            return run(refresh);
        if (b.dataset.intakeSelect)
            return select(b.dataset.intakeSelect);
        if (b.dataset.intakeResume)
            return run(async () => { await api('/api/awos/intakes/resume', { method: 'POST', body: { commandId: b.dataset.intakeResume } }); await refresh(); message(tx("intake-panel.mountIntakes.capture_recovered_from_awos.b0d10b9")); });
        if (b.dataset.intakePropose) {
            const c = data.contacts.find(c => c.id === b.dataset.intakePropose);
            if (c)
                doc.dispatchEvent(new CustomEvent('awos-intake-propose', { detail: { contactId: c.id, intakeCommandId: b.dataset.intakeCommand } }));
        }
    });
    root.addEventListener('submit', e => {
        const form = e.target;
        if (!form.matches('[data-intake-paste],[data-intake-check],[data-intake-confirm]'))
            return;
        e.preventDefault();
        run(async () => {
            if (form.hasAttribute('data-intake-paste')) {
                const value = { text: form.elements.text.value, sender: form.elements.sender.value, channel: form.elements.channel.value }, identity = JSON.stringify(value);
                if (pendingPaste?.identity !== identity)
                    pendingPaste = { identity, body: { commandId: crypto.randomUUID(), ...value } };
                const source = await api('/api/awos/intakes/messages', { method: 'POST', body: pendingPaste.body });
                pendingPaste = null;
                form.reset();
                await refresh();
                select(source.id);
                message(tx("intake-panel.mountIntakes.request_saved_review_the_contact.d4e55c1"));
                doc.dispatchEvent(new CustomEvent('awos-intakes-changed'));
                return;
            }
            if (form.hasAttribute('data-intake-check')) {
                preview = await api('/api/awos/intakes/preview', { method: 'POST', body: { messageId: selected.id, name: form.elements.name.value, email: form.elements.email.value, phone: form.elements.phone.value } });
                bindValue(editor.querySelector('[data-intake-preview]'), "innerHTML", () => intakePreviewHtml(preview));
                message(tx("intake-panel.mountIntakes.matches_loaded_review_and_confirm.ce5b75e"));
                return;
            }
            if (!preview)
                throw Error(tx("intake-panel.mountIntakes.refresh_matches_before_confirming.9e81e44"));
            const value = { messageId: preview.messageId, name: preview.name, email: preview.email, phone: preview.phone, previewHash: preview.previewHash, contactId: preview.matches.length ? form.elements.contactId.value : null, confirmed: true }, identity = JSON.stringify(value);
            if (pendingCapture?.identity !== identity)
                pendingCapture = { identity, body: { commandId: crypto.randomUUID(), ...value } };
            await api('/api/awos/intakes/capture', { method: 'POST', body: pendingCapture.body });
            pendingCapture = null;
            preview = null;
            selected = null;
            bindValue(editor, "innerHTML", () => '');
            await refresh();
            message(tx("intake-panel.mountIntakes.request_linked_to_awos_crm.0f35f58"));
            doc.dispatchEvent(new CustomEvent('awos-intakes-changed'));
        });
    });
    doc.addEventListener('awos-intake-select', e => run(async () => { await refresh(); select(e.detail.messageId); }));
    return { refresh };
}
