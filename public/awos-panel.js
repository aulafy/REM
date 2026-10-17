import {prependLocalized} from './i18n.js';
import {formatDate} from './i18n.js';
import {getLanguage} from './i18n.js';
import {currentUiMessage} from './i18n.js';
import { bindValue, localized } from './i18n.js';
import { t as tx } from './i18n.js';
import { businessHtml } from './business-controls.js';
import { followupLocalValue, followupInstant, followupCommands } from './followup-controls.js';
// Experimental screen only. Authority and displayed payload come from AWOS.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const stateLabel = s => ({ draft: tx("awos-panel.stateLabel.draft.ebf12ef"), approval: tx("awos-panel.stateLabel.awaiting_review.4848885"), ready: tx("awos-panel.stateLabel.approved_not_sent.c902ece"), rejected: tx("awos-panel.stateLabel.rejected.aea4a04"), blocked: tx("awos-panel.stateLabel.needs_attention.c1ebc78"), uncertain: tx("awos-panel.stateLabel.uncertain_result_do_not_resend.8fcfdf3"), running: tx("awos-panel.stateLabel.in_progress.c1f88e9"), failed: tx("awos-panel.stateLabel.failed.031a8f0"), completed: tx("awos-panel.stateLabel.completed.22a970d"), cancelled: tx("awos-panel.stateLabel.cancelled.d353a99") }[s] ?? tx("awos-panel.stateLabel.unrecognized_state.651acaf"));
export function operationHtml(op, followups = [], defaultDue = '', latestOperation = op.latest ? op : null, business = null) {
    const r = op.remote, p = r?.review?.payload, uncertain = ['uncertain', 'unknown', 'blocked', 'failed', 'running', 'completed', 'cancelled'].includes(op.state) || r?.effects?.length;
    const replacement = r?.runtimeReplacement, canDecide = !op.businessStop && op.latest && !op.legacyUnlinked && !uncertain && p && !r.decision && op.state === 'approval';
    const canEdit = op.businessStop?.kind !== 'close' && op.latest && !op.legacyUnlinked && !uncertain && replacement?.canReplace;
    const followup = followups.find(f => f.op_id === op.opId && f.version === op.version), canFollow = !op.businessStop && op.latest && !op.legacyUnlinked && !!op.template && op.state === 'ready' && !uncertain, canSchedule = canFollow && !followup, canReschedule = !latestOperation?.businessStop && latestOperation?.opId === op.opId && latestOperation.latest && !latestOperation.legacyUnlinked && !!latestOperation.template && latestOperation.state === 'ready' && !latestOperation.remote?.effects?.length && !followups.some(f => f.op_id === op.opId && f.version === latestOperation.version);
    return tx("awos-panel.operationHtml.version_runtime_history.b412fe0", op.version, esc(replacement?.replacementTaskId ? tx("awos-panel.operationHtml.superseded_sending_blocked.1f10090") : stateLabel(op.state)), replacement?.replacementTaskId ? tx("awos-panel.operationHtml.supersession_recorded_in_awos_the.730dc2b", esc(replacement.replacementTaskId)) : !op.latest ? tx("awos-panel.operationHtml.older_version_its_original_decision.12c14c9") : '', esc(op.taskId), p ? tx("awos-panel.operationHtml.from_to_subject_review.2b22d29", esc(p.from), esc(p.to.join(', ')), esc(p.subject), esc(p.body), esc(r.review.bindingHash)) : tx("awos-panel.operationHtml.operation_awaiting_runtime_confirmation.f29d3f5"), op.legacyUnlinked ? tx("awos-panel.operationHtml.history_from_an_earlier_experimental.5e902c5") : '', (op.avisosFecha ?? []).length ? tx("awos-panel.operationHtml.review_dates_not_authorized_by.d54e998", op.avisosFecha.map(esc).join(', ')) : '', (op.avisos ?? []).length ? tx("awos-panel.operationHtml.review_numbers_absent_from_the.31146b9", op.avisos.map(esc).join(', ')) : '', op.intakeCommandId ? tx("awos-panel.operationHtml.this_review_retains_its_source.bdfa10e") : '', op.state === 'ready' ? tx("awos-panel.operationHtml.approval_recorded_sending_is_disabled.14b41c5") : '', canSchedule ? tx("awos-panel.operationHtml.schedule_follow_up_due_date.4cc122f", esc(op.opId), op.version, esc(followupLocalValue(defaultDue))) : '', followup ? `<section class="followup"><strong>${followup.state === 'due' ? tx("awos-panel.operationHtml.pending_follow_up.4429791") : followup.state === 'superseded' ? tx("awos-panel.operationHtml.superseded_follow_up.1b1ba59") : followup.state === 'drafted' ? tx("awos-panel.operationHtml.prepared_follow_up.f6feeeb") : followup.state === 'dismissed' ? (followup.stop_command_id ? tx("awos-panel.operationHtml.stopped_after_reply_or_closure.afe68b6") : tx("awos-panel.operationHtml.dismissed_follow_up.ac0b206")) : tx("awos-panel.operationHtml.scheduled_follow_up.6e8132f")}</strong><p>${esc(formatDate(followup.due_at,{dateStyle:'short',timeStyle:'short'}))}${followup.note ? ` · ${esc(followup.note)}` : ''}</p>${followup.state === 'due' && canFollow ? tx("awos-panel.operationHtml.prepare_follow_up_dismiss_follow.ec72ee7", esc(followup.id), esc(followup.id)) : ''}${followup.state === 'superseded' && canReschedule ? tx("awos-panel.operationHtml.reschedule_against_the_new_version.5352e31", esc(op.opId)) : ''}${uncertain && ['scheduled', 'due'].includes(followup.state) ? tx("awos-panel.operationHtml.awos_state_is_unsafe_for.72bdaf2") : ''}</section>` : '', canDecide ? tx("awos-panel.operationHtml.approve_this_content_reject_this.0887f72", esc(op.opId), op.version, esc(r.review.bindingHash), esc(op.opId), op.version, esc(r.review.bindingHash)) : '', canEdit ? tx("awos-panel.operationHtml.prepare_new_version.c326d79", esc(op.opId), op.version) : '', op.latest && !uncertain ? tx("awos-panel.operationHtml.check_and_recover.e433337", esc(op.opId), op.version) : '', businessHtml(op, business), (r?.audit ?? []).map(a => `<li>${esc(a.type)} · ${esc(formatDate(a.at,{dateStyle:'short',timeStyle:'short'}))}</li>`).join(''), r?.decision ? tx("awos-panel.operationHtml.decision_actor.3d9f7c7", esc(r.decision.decision), esc(r.decision.userId)) : '');
}
// Runtime failures must not disable the independent recovery controls.
export const runtimeButtons = section => [...section.querySelectorAll('button')].filter(b => !b.closest('#awos-copies'));
export function mountAwos({ api }) {
    const nav = document.getElementById('awos-nav'), navMore = document.getElementById('awos-more'), section = document.getElementById('v-awos'), form = document.getElementById('awos-form'), templateForm = document.getElementById('awos-template-form'), list = document.getElementById('awos-list'), status = document.getElementById('awos-status'), preview = document.getElementById('awos-preview');
    const commands = followupCommands();
    templateForm.elements.language.value=getLanguage();
    let selectedIntake = null, businessPending = null, moduleKind = null;
    let data, edit = null, pending = null, decisionPending = null, busy = false, connected = false;
    const message = (t, focus = false) => {
        bindValue(status, "textContent", () => currentUiMessage(t));
        if (focus)
            status.focus({ preventScroll: true });
    };
    async function schedule(value) { const input = commands.input(value); await api('/api/awos/followups/schedule', { method: 'POST', body: input }); commands.confirmed(value); }
    async function refresh() {
        try {
            const next = await api('/api/awos');
            if (!next.enabled) {
                nav.hidden = true;
                navMore && (navMore.hidden = true);
                return;
            }
            data = next;
            connected = true;
            nav.hidden = false;
            navMore && (navMore.hidden = false);
            section.dataset.enabled = '1';
            bindValue(document.getElementById('awos-planner'), "textContent", () => next.planner === 'synthetic' ? tx("awos-panel.refresh.synthetic_planner.760849d") : tx("awos-panel.refresh.local_planner.c75f6f2"));
            const select = form.elements.contactId, selected = select.value;
            bindValue(select, "innerHTML", () => next.contacts.map(c => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.email)}</option>`).join(''));
            if ([...select.options].some(o => o.value === selected))
                select.value = selected;
            const templates = form.elements.templateId, selectedTemplate = templates.value;
            bindValue(templates, "innerHTML", () => next.templates.map(t => tx("awos-panel.refresh.v.13a8cd4", esc(t.id), t.version, esc(t.nombre), t.version)).join(''));
            if ([...templates.options].some(o => o.value === selectedTemplate))
                templates.value = selectedTemplate;
            const visible = moduleKind === 'followups' ? next.operations.filter(o => o.followupId || next.followups.some(f => f.op_id === o.opId && f.version === o.version) || o.latest && o.template && o.state === 'ready') : moduleKind === 'closure' ? next.operations.filter(o => next.business?.contexts.some(c => c.opId === o.opId && c.version === o.version)) : moduleKind === 'proposals' ? next.operations.filter(o => !o.followupId) : next.operations;
            bindValue(list, "innerHTML", () => visible.length ? visible.map(op => operationHtml(op, next.followups, next.defaultFollowupDue, next.operations.find(n => n.opId === op.opId && n.latest), next.business)).join('') : tx("awos-panel.refresh.no_work_in_this_module.d9669a2"));
            if (businessPending)
                prependLocalized(list, () => tx("awos-panel.refresh.a_business_record_is_unconfirmed.c4eba6e"));
        }
        catch (e) {
            connected = false;
            bindValue(list, "innerHTML", () => tx("awos-panel.refresh.could_not_load_reviews_choose.1d78dba"));
            runtimeButtons(section).forEach(b => b.disabled = b.id !== 'awos-refresh');
            message(tx("awos-panel.refresh.runtime_unavailable_o_respuesta_no.71cb6a4") + e.message);
            throw e;
        }
    }
    const request = async (fn) => {
        if (busy)
            return;
        busy = true;
        runtimeButtons(section).forEach(b => b.disabled = true);
        try {
            await fn();
        }
        catch (e) {
            message(tx("awos-panel.request.operation_unconfirmed.2b6640e") + e.message);
            try {
                await refresh();
            }
            catch { }
        }
        finally {
            busy = false;
            runtimeButtons(section).forEach(b => b.disabled = !connected && b.id !== 'awos-refresh');
        }
    };
    async function saveBusiness() {
        const p = businessPending;
        if (!p)
            return;
        if (p.values.kind === "reply" && !p.values.messageId) {
            const m = await api('/api/awos/intakes/messages', { method: 'POST', body: p.paste });
            p.values.messageId = m.id;
        }
        try {
            await api('/api/awos/business/record', { method: 'POST', body: { ...p.values, commandId: p.commandId } });
        }
        catch (e) {
            if (['AWOS_BUSINESS_CHANGED', 'AWOS_BUSINESS_INPUT_INVALID', 'AWOS_BUSINESS_SCOPE'].includes(e.code))
                businessPending = null;
            throw e;
        }
        businessPending = null;
        await refresh();
        message(tx("awos-panel.saveBusiness.business_record_confirmed_in_awos.e2e8828"), true);
    }
    const proposal = () => { const option = form.elements.templateId.selectedOptions[0]; return { language: form.elements.language.value || getLanguage(), templateId: form.elements.templateId.value, templateVersion: Number(option?.dataset.version), variables: Object.fromEntries(['cliente', 'servicio', 'importe', 'plazo', 'validez', 'condiciones'].map(k => [k, form.elements[k].value])) }; };
    async function showPreview() { const out = await api('/api/proposal-templates/render', { method: 'POST', body: proposal() }); preview.replaceChildren(); const title = document.createElement('h4'), body = document.createElement('pre'); bindValue(title, "textContent", () => out.subject); bindValue(body, "textContent", () => out.body); body.className = 'awos-body'; preview.append(title, body); return out; }
    form.addEventListener('submit', e => {
        e.preventDefault();
        request(async () => {
            const p = proposal(), value = { contactId: form.elements.contactId.value, proposal: p, request: tx("awos-panel.value.propuesta_comercial_para_importe_plazo.27c9bdb", p.variables.cliente, p.variables.servicio, p.variables.importe, p.variables.plazo, p.variables.validez), ...(selectedIntake ? { intakeCommandId: selectedIntake } : {}) };
            const identity = JSON.stringify({ edit, value });
            if (!pending || pending.identity !== identity)
                pending = { identity, input: { ...value, opId: edit?.opId ?? crypto.randomUUID(), commandId: crypto.randomUUID(), expectedVersion: edit?.version ?? 0 } };
            message(tx("awos-panel.mountAwos.saving_and_preparing_review.77f4db1"));
            await api('/api/awos/prepare', { method: 'POST', body: pending.input });
            pending = null;
            edit = null;
            bindValue(document.getElementById('awos-editing'), "textContent", () => tx("awos-panel.mountAwos.prepare_proposal.7eea063"));
            await refresh();
            message(tx("awos-panel.mountAwos.review_prepared_check_the_content.6a662fc"));
        });
    });
    section.addEventListener('click', e => {
        const target = e.target.closest('button');
        if (!target)
            return;
        if (target.dataset.businessRetry) {
            request(saveBusiness);
            return;
        }
        if (target.dataset.businessResume) {
            request(async () => { await api('/api/awos/business/resume', { method: 'POST', body: { commandId: target.dataset.businessResume } }); businessPending = null; await refresh(); message(tx("awos-panel.mountAwos.record_recovered_from_awos.d094f26")); });
            return;
        }
        if (target.id === 'rm-workbench-all') {
            document.dispatchEvent(new CustomEvent('rem-module-exit'));
            moduleKind = null;
            delete section.querySelector('.awos-page').dataset.moduleKind;
            document.getElementById('rm-workbench-bar').hidden = true;
            bindValue(document.getElementById('rm-workbench-title'), "textContent", () => tx("awos-panel.extra.0c8b3c6ed"));
            bindValue(document.getElementById('rm-workbench-subtitle'), "textContent", () => tx("awos-panel.extra.505617bd4"));
            request(refresh);
            return;
        }
        if (target.id === 'awos-intake-unlink') {
            selectedIntake = null;
            edit = null;
            pending = null;
            document.getElementById('awos-intake-source').hidden = true;
            bindValue(document.getElementById('awos-editing'), "textContent", () => tx("awos-panel.extra.7eea0636b"));
            message(tx("awos-panel.mountAwos.new_manual_proposal_previous_reviews.292a0ba"));
            return;
        }
        if (target.id === 'awos-refresh') {
            request(refresh);
            return;
        }
        if (target.dataset.followupPrepare) {
            request(async () => { await api('/api/awos/followups/prepare', { method: 'POST', body: { id: target.dataset.followupPrepare } }); await refresh(); message(tx("awos-panel.mountAwos.follow_up_draft_prepared_it.fc3a709"), true); });
            return;
        }
        if (target.dataset.followupReschedule) {
            const newest = data.operations.find(o => o.opId === target.dataset.followupReschedule && o.latest);
            if (newest)
                request(async () => { await schedule({ opId: newest.opId, version: newest.version, note: '', dueAt: data.defaultFollowupDue }); await refresh(); message(tx("awos-panel.mountAwos.follow_up_rescheduled_against_the.cdf33f6")); });
            return;
        }
        if (target.id === 'awos-preview-button') {
            request(async () => { await showPreview(); message(tx("awos-panel.mountAwos.deterministic_preview_updated.fee7e0f")); });
            return;
        }
        if (target.id === 'awos-template-edit') {
            const t = data.templates.find(x => x.id === form.elements.templateId.value);
            if (!t)
                return;
            templateForm.elements.language.value=t.language||'es';
            for (const k of ['id', 'nombre', 'asunto', 'cuerpo'])
                templateForm.elements[k].value = t[k];
            document.getElementById('awos-template-delete').hidden = false;
            templateForm.elements.nombre.focus();
            return;
        }
        if (target.id === 'awos-suggest') {
            request(async () => { const out = await api('/api/awos/proposal-suggestion', { method: 'POST', body: { language:form.elements.language.value||getLanguage(),kind: 'condiciones', cliente: form.elements.cliente.value, servicio: form.elements.servicio.value } }); form.elements.condiciones.value = out.text; document.getElementById('awos-suggestion-note').hidden = false; message(tx("awos-panel.mountAwos.local_suggestion_added_edit_it.dfac6a5")); });
            return;
        }
        if (target.dataset.awosEdit) {
            request(async () => {
                const op = data.operations.find(o => o.opId === target.dataset.awosEdit && o.version === Number(target.dataset.version));
                if (!op.template) {
                    message(tx("awos-panel.mountAwos.this_older_review_has_no.50c038d"));
                    return;
                }
                const templates = await api(`/api/proposal-templates/${op.template.templateId}`), source = templates.find(t => t.version === op.template.templateVersion);
                if (!source)
                    throw Error(tx("awos-panel.mountAwos.the_template_version_is_no.2938cae"));
                let option = [...form.elements.templateId.options].find(o => o.value === source.id && Number(o.dataset.version) === source.version);
                if (!option) {
                    option = new Option(tx("awos-panel.mountAwos.v.07016e3", source.nombre, source.version), source.id);
                    option.dataset.version = source.version;
                    form.elements.templateId.add(option);
                }
                option.selected = true;
                edit = { opId: op.opId, version: op.version };
                selectedIntake = op.intakeCommandId ?? null;
                document.getElementById('awos-intake-source').hidden = !selectedIntake;
                form.elements.contactId.value = op.desired.contactId;
                for (const key of ['cliente', 'servicio', 'plazo', 'validez', 'condiciones'])
                    form.elements[key].value = op.template.variables[key] ?? '';
                form.elements.language.value=op.template.language||'es';
                form.elements.importe.value = String(op.template.variables.importe ?? '').replace(/\s+EUR$/, '');
                pending = null;
                bindValue(document.getElementById('awos-editing'), "textContent", () => tx("awos-panel.mountAwos.new_version_based_on_version.ff5c169", op.version));
                form.elements.condiciones.focus();
            });
            return;
        }
        if (target.dataset.awosDecide) {
            request(async () => {
                const body = { opId: target.dataset.op, version: Number(target.dataset.version), bindingHash: target.dataset.binding, decision: target.dataset.awosDecide };
                if (!decisionPending || JSON.stringify(decisionPending.body) !== JSON.stringify(body))
                    decisionPending = { body, commandId: crypto.randomUUID() };
                await api('/api/awos/decision', { method: 'POST', body: { ...body, commandId: decisionPending.commandId } });
                decisionPending = null;
                await refresh();
                message(tx("awos-panel.mountAwos.decision_recorded_in_awos_no.8c8406b"));
            });
            return;
        }
        if (target.dataset.awosResume)
            request(async () => { message(tx("awos-panel.mountAwos.checking_and_recovering_the_operation.74ae66e")); await api('/api/awos/resume', { method: 'POST', body: { opId: target.dataset.awosResume, version: Number(target.dataset.version) } }); await refresh(); message(tx("awos-panel.mountAwos.state_recovered_from_awos.6460921")); });
    });
    section.addEventListener('submit', e => {
        const bf = e.target.closest('[data-business]');
        if (bf) {
            e.preventDefault();
            request(async () => {
                const c = data.business.contexts.find(c => c.opId === bf.dataset.op && c.version === Number(bf.dataset.version));
                if (!c || c.error)
                    throw Error(tx("awos-panel.mountAwos.opportunity_unavailable.25cdc03"));
                const kind = bf.dataset.business, values = { opId: c.opId, version: c.version, bindingHash: c.bindingHash, leadId: c.leadId, expectedCrmRevision: c.revision, kind, messageId: null, status: kind === 'close' ? bf.elements.status.value : null, reason: kind === 'close' ? bf.elements.reason.value : tx("awos-panel.values.manual_reply.3462d06"), confirmed: bf.elements.confirmed.checked };
                const identity = JSON.stringify({ values: { ...values, expectedCrmRevision: null }, text: kind === "reply" ? bf.elements.text.value : null, channel: kind === "reply" ? bf.elements.channel.value : null });
                if (businessPending && businessPending.identity !== identity)
                    throw Error(tx("awos-panel.mountAwos.a_record_is_pending_recover.748262b"));
                businessPending ??= { identity, commandId: crypto.randomUUID(), values, paste: kind === "reply" ? { commandId: crypto.randomUUID(), text: bf.elements.text.value, sender: c.to.join(', '), channel: bf.elements.channel.value } : null };
                await saveBusiness();
            });
            return;
        }
        const dismiss = e.target.closest('[data-followup-dismiss-form]');
        if (dismiss) {
            e.preventDefault();
            request(async () => { await api('/api/awos/followups/dismiss', { method: 'POST', body: { id: dismiss.dataset.followupDismissForm, reason: dismiss.elements.reason.value } }); await refresh(); message(tx("awos-panel.mountAwos.follow_up_dismissed_history_is.49691a2"), true); });
            return;
        }
        const f = e.target.closest('[data-followup-schedule]');
        if (!f)
            return;
        e.preventDefault();
        request(async () => { await schedule({ opId: f.dataset.followupSchedule, version: Number(f.dataset.version), dueAt: followupInstant(f.elements.dueAt.value), note: f.elements.note.value }); await refresh(); message(tx("awos-panel.mountAwos.follow_up_scheduled_nothing_was.872af20"), true); });
    });
    templateForm.addEventListener('submit', e => { e.preventDefault(); request(async () => { const id = templateForm.elements.id.value, body = {language:templateForm.elements.language.value, nombre: templateForm.elements.nombre.value, asunto: templateForm.elements.asunto.value, cuerpo: templateForm.elements.cuerpo.value }; await api(id ? `/api/proposal-templates/${id}` : '/api/proposal-templates', { method: id ? 'PUT' : 'POST', body }); templateForm.reset(); document.getElementById('awos-template-delete').hidden = true; await refresh(); bindValue(document.getElementById('awos-template-status'), "textContent", () => tx("awos-panel.mountAwos.template_saved_as_a_new.b01d136")); }); });
    templateForm.addEventListener('click', e => {
        if (e.target.id === 'awos-template-new') {
            templateForm.reset();
            templateForm.elements.language.value=getLanguage();
            templateForm.elements.nombre.value=tx('template.starter.name');
            templateForm.elements.asunto.value=tx('template.starter.subject');
            templateForm.elements.cuerpo.value=tx('template.starter.body');
            document.getElementById('awos-template-delete').hidden = true;
        }
        if (e.target.id === 'awos-template-delete')
            request(async () => { await api(`/api/proposal-templates/${templateForm.elements.id.value}`, { method: 'DELETE' }); templateForm.reset(); await refresh(); });
    });
    document.addEventListener('awos-intake-propose', e => request(async () => {
        await refresh();
        const c = data.contacts.find(c => c.id === e.detail.contactId);
        if (!c)
            throw Error(tx("awos-panel.mountAwos.the_contact_no_longer_has.ce94c2a"));
        edit = null;
        pending = null;
        selectedIntake = e.detail.intakeCommandId;
        document.getElementById('awos-intake-source').hidden = !selectedIntake;
        form.elements.contactId.value = c.id;
        form.elements.cliente.value = c.name;
        bindValue(document.getElementById('awos-editing'), "textContent", () => tx("awos-panel.mountAwos.prepare_proposal.7eea063"));
        form.elements.servicio.focus();
        message(tx("awos-panel.mountAwos.contact_loaded_from_awos_complete.04d298a"));
    }));
    document.addEventListener('rem-module-open', e => {
        if (e.detail.kind === 'requests')
            return;
        moduleKind = e.detail.kind;
        section.querySelector('.awos-page').dataset.moduleKind = moduleKind;
        document.getElementById('rm-workbench-bar').hidden = false;
        bindValue(document.getElementById('rm-workbench-title'), "textContent", () => e.detail.title);
        bindValue(document.getElementById('rm-workbench-subtitle'), "textContent", () => e.detail.subtitle + tx("awos-panel.extra.4c74a6aba"));
        request(refresh);
    });
    document.addEventListener('awos-copy-changed', () => {
        if (!busy)
            request(refresh);
    });
    return refresh().catch(() => { });
}
