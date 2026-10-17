import {formatNumber} from './i18n.js';
import {currentUiMessage} from './i18n.js';
import { bindValue, localized } from './i18n.js';
import { t as tx } from './i18n.js';
import { displayText } from './display-text.js';
import { parseModuleCatalog, moduleKit, MODULE_KINDS } from './module-contract.js';
import { moduleCard, moduleDetail, moduleError } from './module-ui.js';
export function mountModuleLibrary({ api, onOpen, document: doc = globalThis.document }) {
    const root = doc.getElementById('v-modulos');
    if (!root)
        return;
    const grid = root.querySelector('#rm-grid'), count = root.querySelector('#rm-result-count'), status = root.querySelector('#rm-status');
    const dialog = doc.getElementById('rm-module-dialog'), search = root.querySelector('#rm-search');
    let catalog = null, filter = 'all', selected = null, pending = null, busy = false, conflict = false, opener = null, generation = 0;
    const feedback = text => { bindValue(status, "textContent", () => currentUiMessage(text)); };
    const fold = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es');
    const active = item => !!item.installation?.enabled && item.installation.version === item.manifest.version;
    function render() {
        const q = fold(search.value).trim();
        const items = catalog.items.filter(i => {
            const text = fold([displayText(i.manifest.name), displayText(i.manifest.description), displayText(i.installation?.config.title) ?? '', MODULE_KINDS[i.manifest.kind].group].join(' '));
            return (!q || text.includes(q)) && (filter === 'all' || filter === 'active' && active(i) || filter === 'paused' && i.installation && !i.installation.enabled);
        });
        bindValue(grid, "innerHTML", () => items.length ? items.map(moduleCard).join('') : tx("module-library.render.no_modules_match_this_filter.c4daef0"));
        bindValue(count, "textContent", () => `${formatNumber(items.length)} ${items.length === 1 ? tx("module-library.render.module.120970d") : tx("module-library.render.modules.fbc6c1d")}`);
        bindValue(root.querySelector('#rm-included'), "textContent", () => tx("module-library.render.reusable_modules.883c2f2", formatNumber(catalog.items.length)));
        bindValue(root.querySelector('#rm-active-count'), "textContent", () => formatNumber(catalog.items.filter(active).length));
    }
    async function refresh() {
        const ticket = ++generation;
        root.setAttribute('aria-busy', 'true');
        feedback(tx("module-library.refresh.checking_module_status.d0039f8"));
        try {
            const v = await api('/api/awos/modules');
            if (ticket !== generation)
                return;
            if (!v.enabled) {
                catalog = null;
                bindValue(root.querySelector('#rm-active-count'), "textContent", () => '—');
                bindValue(root.querySelector('#rm-included'), "textContent", () => tx("module-library.refresh.runtime_not_enabled.4d67494"));
                bindValue(grid, "innerHTML", () => tx("module-library.refresh.workspace_processes_are_not_enabled.789ebe9"));
                bindValue(count, "textContent", () => tx("module-library.refresh.runtime_not_enabled.4d67494"));
                feedback(tx("module-library.refresh.no_operational_modules_are_active.75a767b"));
                return;
            }
            catalog = parseModuleCatalog(v);
            render();
            feedback(tx("module-library.refresh.state_updated_this_configuration_does.dbb5f9f"));
        }
        catch {
            if (ticket !== generation)
                return;
            catalog = null;
            bindValue(root.querySelector('#rm-active-count'), "textContent", () => '—');
            bindValue(root.querySelector('#rm-included'), "textContent", () => tx("module-library.refresh.runtime_unavailable.9ded5a3"));
            bindValue(grid, "innerHTML", () => moduleError());
            bindValue(count, "textContent", () => tx("module-library.refresh.unavailable.ca18449"));
            feedback(tx("module-library.refresh.could_not_confirm_the_state.7a5e659"));
        }
        finally {
            if (ticket === generation)
                root.setAttribute('aria-busy', 'false');
        }
    }
    function returnFocus(id, stable = false) {
        const kind = opener?.classList.contains('rm-settings') ? 'rm-settings' : 'rm-open';
        const equivalent = root.querySelector(`.${kind}[data-module-open="${id}"]`) ?? root.querySelector(`.${kind}[data-module-detail="${id}"]`);
        const fallback = root.querySelector(`[data-module-filter="${filter}"]`) ?? search;
        const target = stable ? fallback : opener?.isConnected ? opener : equivalent ?? fallback;
        target?.focus();
    }
    function close() {
        if (busy)
            return;
        const id = selected?.manifest.id, unknown = !!pending;
        dialog.close();
        selected = null;
        pending = null;
        conflict = false;
        returnFocus(id, unknown);
        if (unknown)
            void refresh();
    }
    function fillDetail(item) {
        selected = item;
        pending = null;
        conflict = false;
        bindValue(dialog, "innerHTML", () => moduleDetail(item, catalog.revision, catalog.audit));
    }
    function detail(id, button) {
        const item = catalog?.items.find(i => i.manifest.id === id);
        if (!item)
            return;
        opener = button;
        fillDetail(item);
        dialog.showModal();
        dialog.querySelector('input[name="title"]').focus();
    }
    function lockButtons() { dialog.querySelectorAll('button').forEach(n => n.disabled = busy || n.dataset.blocked === '1'); }
    async function reloadDetail() {
        if (busy || !conflict || !selected)
            return;
        const id = selected.manifest.id, ticket = ++generation;
        busy = true;
        lockButtons();
        root.setAttribute('aria-busy', 'true');
        const message = dialog.querySelector('#rm-dialog-status');
        bindValue(message, "textContent", () => tx("module-library.reloadDetail.reading_the_current_configuration_no.4f4d180"));
        try {
            const v = parseModuleCatalog(await api('/api/awos/modules'));
            if (ticket !== generation) {
                bindValue(message, "textContent", () => tx("module-library.reloadDetail.a_newer_request_exists_refresh.f9b05c9"));
                return;
            }
            const item = v.items.find(i => i.manifest.id === id);
            if (!item)
                throw Error('MODULE_NOT_AVAILABLE');
            catalog = v;
            render();
            fillDetail(item);
            dialog.querySelector('input[name="title"]').focus();
            bindValue(dialog.querySelector('#rm-dialog-status'), "textContent", () => tx("module-library.reloadDetail.configuration_refreshed_review_the_fields.d892162"));
        }
        catch {
            bindValue(message, "textContent", () => tx("module-library.reloadDetail.could_not_refresh_the_dialog.515d2f2"));
        }
        finally {
            busy = false;
            lockButtons();
            if (ticket === generation)
                root.setAttribute('aria-busy', 'false');
        }
    }
    root.addEventListener('input', e => {
        if (e.target === search && catalog)
            render();
    });
    root.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b)
            return;
        if (b.dataset.moduleRefresh !== undefined) {
            void refresh();
            return;
        }
        if (b.dataset.moduleFilter) {
            filter = b.dataset.moduleFilter;
            root.querySelectorAll('[data-module-filter]').forEach(n => n.setAttribute('aria-pressed', String(n === b)));
            if (catalog)
                render();
            return;
        }
        if (b.dataset.moduleClear !== undefined) {
            search.value = '';
            filter = 'all';
            root.querySelector('[data-module-filter="all"]').click();
            search.focus();
            return;
        }
        if (b.dataset.moduleDetail) {
            detail(b.dataset.moduleDetail, b);
            return;
        }
        if (b.dataset.moduleOpen) {
            const item = catalog?.items.find(i => i.manifest.id === b.dataset.moduleOpen);
            if (item && active(item))
                onOpen(item);
        }
    });
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b)
            return;
        if (b.dataset.moduleClose !== undefined) {
            close();
            return;
        }
        if (b.dataset.moduleReload !== undefined) {
            void reloadDetail();
            return;
        }
        if (b.dataset.moduleKit) {
            const item = catalog?.items.find(i => i.manifest.id === b.dataset.moduleKit);
            if (!item)
                return;
            const url = URL.createObjectURL(new Blob([moduleKit(item)], { type: 'text/markdown;charset=utf-8' })), a = doc.createElement('a');
            a.href = url;
            a.download = 'REM_MODULO_' + item.manifest.kind + '.md';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    });
    dialog.addEventListener('submit', async (e) => {
        if (e.target.id !== 'rm-config-form')
            return;
        e.preventDefault();
        if (busy || conflict || !selected || !catalog)
            return;
        const f = e.target, m = selected.manifest;
        // A lost response keeps this exact command, even if controls change programmatically.
        if (!pending)
            pending = { sdkVersion: 2, capsuleId: m.id, version: m.version, expectedRevision: Number(f.elements.revision.value), enabled: f.elements.enabled.checked, grants: m.capabilities, config: { title: f.elements.title.value.trim(), subtitle: f.elements.subtitle.value.trim() }, commandId: crypto.randomUUID() };
        busy = true;
        f.querySelectorAll('input,textarea').forEach(n => n.disabled = true);
        lockButtons();
        const message = dialog.querySelector('#rm-dialog-status');
        bindValue(message, "textContent", () => tx("module-library.extra.4da6a93a7"));
        try {
            const v = await api('/api/awos/modules/configure', { method: 'POST', body: pending });
            catalog = parseModuleCatalog(v);
            pending = null;
            render();
            busy = false;
            close();
            feedback(tx("module-library.mountModuleLibrary.configuration_saved_work_and_history.00b421b"));
            doc.dispatchEvent(new CustomEvent('rem-modules-changed'));
        }
        catch (err) {
            conflict = err.code === 'CAPSULE_REVISION_CONFLICT';
            bindValue(message, "textContent", () => conflict ? tx("module-library.extra.9d04abcbe") : tx("module-library.extra.c96df5fb2"));
            bindValue(dialog.querySelector('#rm-save'), "textContent", () => conflict ? tx("module-library.extra.6c43c3575") : tx("module-library.extra.9277455e7"));
            dialog.querySelector('#rm-save').dataset.blocked = conflict ? '1' : '0';
            dialog.querySelector('[data-module-reload="true"]').hidden = !conflict;
        }
        finally {
            busy = false;
            lockButtons();
        }
    });
    return { refresh };
}
