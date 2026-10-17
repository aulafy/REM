import {formatDate} from './i18n.js';
import {currentUiMessage} from './i18n.js';
import { bindValue, localized } from './i18n.js';
import { t as tx } from './i18n.js';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = v => formatDate(v,{dateStyle:'short',timeStyle:'short'});
const names = localized(() => ({ create: tx("awos-copies.names.coordinated_copy.07077dc"), import: tx("awos-copies.names.import_saved_copy.dc2a587"), restore: tx("awos-copies.names.separate_restoration.f8f8021"), open: tx("awos-copies.names.open_restored_environment.4be9090"), resume: tx("awos-copies.names.resume_runtime.8354d66") }));
const errors = localized(() => ({ AWOS_COPY_SELECTION_CANCELLED: tx("awos-copies.errors.no_folder_was_selected_nothing.fd0bdaa"), AWOS_COPY_PICKER_UNAVAILABLE: tx("awos-copies.errors.could_not_open_the_macos.d7e73c8"), AWOS_COPY_REPLAY_OR_PAIR_INVALID: tx("awos-copies.errors.database_history_verification_failed_the.b3ee700"), AWOS_COPY_OUTPUT_OVERLAP: tx("awos-copies.errors.the_folder_is_already_in.e58239a"), AWOS_COPY_LAYOUT_INVALID: tx("awos-copies.errors.the_folder_is_not_a.c9648d5"), AWOS_COPY_MANIFEST_INVALID: tx("awos-copies.errors.the_copy_manifest_is_invalid.4480b89"), AWOS_COPY_HASH_MISMATCH: tx("awos-copies.errors.files_do_not_match_the.0d5b8ed"), AWOS_COPY_CHANGED: tx("awos-copies.errors.the_copy_changed_refresh_and.9aee0fb"), AWOS_COPY_UNAVAILABLE: tx("awos-copies.errors.the_copy_or_temporary_environment.5dfdc72"), AWOS_RESTORED_SESSION_CLOSED: tx("awos-copies.errors.the_environment_is_closed_you.5e7f004"), AWOS_START_FAILED: tx("awos-copies.errors.awos_could_not_start_the.011cc33"), AWOS_START_TIMEOUT: tx("awos-copies.errors.awos_did_not_respond_on.3fa7b85") }));
const phases = localized(() => ({ selecting: tx("awos-copies.phases.select_a_folder_in_the.ef5cefa"), selected: tx("awos-copies.phases.folder_selected_identity_saved.8a63cd8"), importing: tx("awos-copies.phases.verifying_copy_files_and_history.82e9e44"), closed: tx("awos-copies.phases.the_restored_environment_is_closed.df0c437"), queued: tx("awos-copies.phases.queued.661ff40"), pausing: tx("awos-copies.phases.draining_operations_and_pausing_awos.82f0595"), validated: tx("awos-copies.phases.copy_verified_saving.4d75122"), restoring: tx("awos-copies.phases.verifying_and_restoring_into_a.bd52a96"), opening: tx("awos-copies.phases.starting_the_restored_environment.31b6493"), resuming: tx("awos-copies.phases.resuming_awos.2e6d298"), completed: tx("awos-copies.phases.completed.22a970d"), recovered: tx("awos-copies.phases.recovered_after_restart.c8f0fce"), failed: tx("awos-copies.phases.operation_unconfirmed.93715bd"), interrupted: tx("awos-copies.phases.interrupted_check_or_retry.1c8fd35"), missing: tx("awos-copies.phases.the_copy_or_environment_is.f10133c"), invalid: tx("awos-copies.phases.could_not_verify.236f6cf") }));
export function restoredUrl(value) {
    try {
        const u = new URL(value);
        return u.protocol === 'http:' && u.hostname === '127.0.0.1' && /^\d+$/.test(u.port) && Number(u.port) >= 1024 && Number(u.port) !== 4317 && u.pathname === '/' && u.hash === '#awos' && !u.username && !u.password && !u.search ? u.href : null;
    }
    catch {
        return null;
    }
}
export function parseCopiesStatus(data) {
    const id = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v), count = v => Number.isSafeInteger(v) && v >= 0, code = v => v === null || typeof v === 'string' && /^AWOS_[A-Z0-9_]+$/.test(v);
    if (data?.enabled === false)
        return data;
    if (!data || data.enabled !== true || typeof data.busy !== 'boolean' || typeof data.runtimeReady !== 'boolean' || !Array.isArray(data.copies) || !Array.isArray(data.jobs) || data.copies.length > 100 || data.jobs.length > 100)
        throw Error(tx("awos-copies.parseCopiesStatus.unrecognized_copy_response_refresh_to.8258029"));
    for (const c of data.copies)
        if (!id(c.copyId) || c.error && !code(c.error) || !c.error && (typeof c.manifestHash !== 'string' || !/^[a-f0-9]{64}$/.test(c.manifestHash) || !Number.isFinite(Date.parse(c.createdAt)) || !count(c.bytes) || !count(c.summary?.reviews) || !count(c.summary?.crmLeads)))
            throw Error(tx("awos-copies.parseCopiesStatus.cannot_verify_the_displayed_copy.00bbaea"));
    for (const j of data.jobs)
        if (!id(j.id) || !['create', 'import', 'restore', 'open', 'resume'].includes(j.kind) || !['running', 'completed', 'failed', 'interrupted'].includes(j.state) || typeof j.phase !== 'string' || !count(j.created) || !count(j.updated) || !code(j.error) || j.kind === 'open' && j.state === 'completed' && !restoredUrl(j.result?.url))
            throw Error(tx("awos-copies.parseCopiesStatus.cannot_verify_the_recovery_result.e4773e9"));
    return data;
}
export function copiesHtml(data, selection = null) {
    data = parseCopiesStatus(data);
    if (!data.enabled)
        return '';
    const busy = !!data.busy, disabled = busy ? ' disabled' : '';
    return tx("awos-copies.copiesHtml.coordinated_copies_and_recovery_refresh.949e0b8", data.runtimeReady === false ? tx("awos-copies.copiesHtml.awos_is_unavailable_copies_and.837eb58") + disabled + tx("awos-copies.copiesHtml.resume_runtime.a67c004") : '', disabled, disabled, busy ? tx("awos-copies.copiesHtml.a_recovery_operation_is_in.06719cb") : '', (data.copies ?? []).map(c => `<article class="awos-card"><h4>${c.error ? tx("awos-copies.copiesHtml.backup_unavailable.6ad6e71") : tx("awos-copies.copiesHtml.copy_from.ffc7822") + esc(date(c.createdAt))}</h4>${c.error ? tx("awos-copies.copiesHtml.the_copy_is_unavailable_or.aa58271") : tx("awos-copies.copiesHtml.kb_reviews_opportunities_restore_into.c1906b5", esc(Math.ceil(c.bytes / 1024)), esc(c.summary?.reviews ?? 0), esc(c.summary?.crmLeads ?? 0), esc(c.copyId), disabled, esc(c.copyId), disabled)}</article>`).join('') || tx("awos-copies.copiesHtml.no_coordinated_copies_create_one.34259e8"), selection ? tx("awos-copies.copiesHtml.restore_into_a_new_environment.080086e", esc(date(selection.createdAt)), esc(selection.summary?.reviews ?? 0), disabled) : '', (data.jobs ?? []).map(j => `<article class="awos-card"><strong>${esc(names[j.kind] ?? tx("awos-copies.copiesHtml.recovery.48f6a8d"))}</strong><p>${esc(phases[j.phase] ?? j.state)} · ${esc(date(j.updated))}</p>${j.error ? `<p role="alert">${esc(errors[j.error] ?? tx("awos-copies.copiesHtml.could_not_confirm_the_operation.eb54399"))}</p>` : ''}${['failed', 'interrupted'].includes(j.state) ? tx("awos-copies.copiesHtml.check_and_retry.e8603cb", esc(j.id), disabled) : ''}${j.kind === 'restore' && j.state === 'completed' ? tx("awos-copies.copiesHtml.prepare_restored_environment_launch.95dbe81", esc(j.id), disabled) : ''}${j.kind === 'open' && j.state === 'completed' && restoredUrl(j.result?.url) ? tx("awos-copies.copiesHtml.open_restored_environment.2397aaf", esc(restoredUrl(j.result.url))) : ''}</article>`).join('') || tx("awos-copies.copiesHtml.no_recovery_operations.db2533c"));
}
export function mountCopies({ api, document: doc = document, setTimer = setTimeout, clearTimer = clearTimeout }) {
    const root = doc.getElementById('awos-copies');
    if (!root)
        return;
    let data = null, selection = null, timer = null, requesting = false, pending = null;
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const content = doc.createElement('div');
    root.append(status, content);
    const message = text => { bindValue(status, "textContent", () => currentUiMessage(text)); };
    async function refresh() {
        clearTimer(timer);
        const wasBusy = !!data?.busy;
        try {
            data = parseCopiesStatus(await api('/api/awos/copies'));
            root.hidden = !data.enabled;
            if (!data.enabled)
                return;
            if (selection && !data.copies.some(c => !c.error && c.copyId === selection.copyId && c.manifestHash === selection.manifestHash)) {
                selection = null;
                message(tx("awos-copies.refresh.the_copy_changed_or_is.32874b5"));
            }
            bindValue(content, "innerHTML", () => copiesHtml(data, selection));
            if (data.busy)
                timer = setTimer(refresh, 700);
            else if (wasBusy)
                doc.dispatchEvent(new CustomEvent('awos-copy-changed'));
            return data;
        }
        catch (e) {
            bindValue(content, "innerHTML", () => '');
            root.hidden = false;
            message(tx("awos-copies.refresh.cannot_confirm_copy_state.372f4e5") + e.message);
        }
    }
    async function send(kind, input) {
        if (requesting)
            return;
        requesting = true;
        if (!pending || pending.kind !== kind || JSON.stringify(pending.value) !== JSON.stringify(input))
            pending = { kind, value: input, body: { requestId: crypto.randomUUID(), ...input } };
        try {
            await api('/api/awos/copies/' + kind, { method: 'POST', body: pending.body });
            pending = null;
            selection = null;
            message(tx("awos-copies.send.request_recorded_check_its_result.3d24ffc"));
        }
        catch (e) {
            message(tx("awos-copies.send.operation_unconfirmed_consulta_la_actividad.dc5f39f") + e.message);
        }
        finally {
            requesting = false;
            await refresh();
            if (!data?.busy)
                doc.dispatchEvent(new CustomEvent('awos-copy-changed'));
        }
    }
    root.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b)
            return;
        if (b.hasAttribute('data-copy-refresh'))
            return refresh();
        if (b.hasAttribute('data-copy-create'))
            return send('create', {});
        if (b.hasAttribute('data-copy-import'))
            return send('import', {});
        if (b.hasAttribute('data-copy-resume'))
            return send('resume', {});
        if (b.dataset.copySelect) {
            selection = data.copies.find(c => c.copyId === b.dataset.copySelect && !c.error) ?? null;
            bindValue(content, "innerHTML", () => copiesHtml(data, selection));
            return;
        }
        if (b.hasAttribute('data-copy-dismiss')) {
            selection = null;
            bindValue(content, "innerHTML", () => copiesHtml(data));
            return;
        }
        if (b.dataset.copyOpen)
            return send('open', { restoreId: b.dataset.copyOpen });
        if (b.dataset.copyRetry) {
            try {
                await api('/api/awos/copies/retry', { method: 'POST', body: { requestId: b.dataset.copyRetry } });
                message(tx("awos-copies.mountCopies.checking_and_recovering_the_same.a26bfd9"));
            }
            catch (e) {
                message(e.message);
            }
            return refresh();
        }
        if (b.dataset.copyReveal) {
            try {
                await api('/api/awos/copies/reveal', { method: 'POST', body: { copyId: b.dataset.copyReveal } });
                message(tx("awos-copies.mountCopies.backup_shown_in_finder.4be358e"));
            }
            catch (e) {
                message(e.message);
            }
            return;
        }
    });
    root.addEventListener('submit', e => {
        if (e.target.id !== 'copy-confirm')
            return;
        e.preventDefault();
        if (!selection)
            return;
        const confirmation = e.target.elements.confirmation.value;
        if (confirmation !== 'RESTAURAR') {
            message(tx("awos-copies.mountCopies.type_restaurar_exactly_to_confirm.9dac85e"));
            return;
        }
        return send('restore', { copyId: selection.copyId, manifestHash: selection.manifestHash, confirmation });
    });
    return { refresh, stop: () => clearTimer(timer) };
}
// Loading the read model may be retried across a maintenance window. This helper
// never submits a command or repeats an approval, restore or provider action.
export async function loadAroundMaintenance(load, onMaintenance, wait = () => new Promise(ok => setTimeout(ok, 500))) {
    for (;;)
        try {
            return await load();
        }
        catch (e) {
            if (e.code !== 'AWOS_MAINTENANCE')
                throw e;
            await onMaintenance(e);
            await wait();
        }
}
