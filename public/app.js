import {getLanguage,setLanguage,formatDate,formatNumber,currentUiMessage,onLanguageChange,prependLocalized} from './i18n.js';
import {createLanguagePreference} from './language-preference.js';
import { bindValue, localized } from './i18n.js';
import { t as tx } from './i18n.js';
import { displayText } from './display-text.js';
import { mountModuleLibrary } from './module-library.js';
import { MODULE_KINDS, scopedModulePath } from './module-contract.js';
'use strict';
import { warningsHtml, dateWarningsHtml } from './proposal-warnings.js';
import { smallModelWarning } from './model-capacity.js';
import { mountIntakes } from './intake-panel.js';
import { mountAwos } from './awos-panel.js';
import { mountCopies, loadAroundMaintenance } from './awos-copies.js';
// Interfaz de REM. Sin dependencias: habla con la API local del propio Mac.
const TOKEN = document.querySelector('meta[name="pyme1-token"]').content;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#${id}"/></svg>`;
const fmtDate = (iso) => {
    if (!iso)
        return '';
    const d = new Date(iso);
    return formatDate(d,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
};
const fmtDay = (ymd) => ymd ? formatDate(`${ymd}T12:00:00`,{weekday:'short',day:'numeric',month:'short'}) : '';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hhmm = (iso) => formatDate(iso,{hour:'numeric',minute:'2-digit'});
const dayKey = (iso) => new Date(iso).toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
const isToday = (iso) => !!iso && dayKey(iso) === new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
function relDay(iso) {
    const k = dayKey(iso), d = new Date();
    const today = d.toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
    d.setDate(d.getDate() - 1);
    const yest = d.toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
    if (k === today)
        return tx("app.relDay.today.e0f4f76");
    if (k === yest)
        return tx("app.relDay.yesterday.9523d9f");
    return formatDate(iso,{weekday:'long',day:'numeric',month:'long'});
}
const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;
const initials = (name) => { const w = String(name || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter((x) => x.length > 1 && !/^(de|del|y)$/i.test(x)); return (w.length ? (w[0][0] + (w[1]?.[0] || '')) : '·').toUpperCase(); };
let S = null;
let languageInitialized=false;
let justStamped = null;
let loadedModels = { local: [], external: [] };
let draftAgents = null;
let loadedLocalUrl = null;
let capacityRequest = null;
let activeRemModule = null;
async function api(path, { method = 'GET', body } = {}) {
    if (activeRemModule && method === 'POST')
        path = scopedModulePath(path, activeRemModule.id);
    const r = await fetch(path, { method, headers: { 'x-pyme1-token': TOKEN,'x-rem-language':getLanguage(), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
        const e = new Error(displayText(data.message) || tx("app.e.something_went_wrong.0c953ab"));
        e.code = data.error;
        throw e;
    }
    return data;
}
let toastTimer;
function toast(msg, bad = false) {
    const t = $('#toast');
    bindValue(t, "textContent", () => currentUiMessage(msg));
    t.classList.toggle('bad', bad);
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), bad ? 5000 : 2800);
}
async function copy(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast(tx("app.copy.copied.8d525e5"));
    }
    catch {
        toast(tx("app.copy.could_not_copy_select_the.5bc8d61"), true);
    }
}
/* ---------------- Navigation ---------------- */
const TITLES = localized(() => ({ modulos: tx("app.TITLES.modules.76c86c4"), hoy: tx("app.TITLES.today.2b065c7"), asistente: tx("app.TITLES.assistant.391e405"), clasificar: tx("app.TITLES.message_triage.a672c9a"), aprobaciones: tx("app.TITLES.review.aff0766"), clientes: tx("app.TITLES.clients.65a7256"), tareas: tx("app.TITLES.tasks.b3a60e6"), encargos: tx("app.TITLES.errands.207b517"), registro: tx("app.TITLES.activity_and_privacy.7d650c1"), ajustes: tx("app.TITLES.settings.74a883a"), awos: tx("app.TITLES.experimental_email.0a6c408") }));
const moreSheet = document.querySelector('#more-sheet');
const moreOpen = document.querySelector('#more-open');
new ResizeObserver(([entry]) => {
    const height = Math.ceil(entry.target.getBoundingClientRect().height);
    if (height)
        document.documentElement.style.setProperty('--mobile-nav-height', `${height}px`);
}).observe(document.querySelector('.mobile-tabs'));
moreOpen.addEventListener('click', () => { moreSheet.showModal(); moreOpen.setAttribute('aria-expanded', 'true'); });
moreSheet.addEventListener('close', () => { moreOpen.setAttribute('aria-expanded', 'false'); moreOpen.focus(); });
function go(view) {
    if (activeRemModule && view !== MODULE_KINDS[activeRemModule.kind].route)
        activeRemModule = null;
    if (moreSheet.open)
        moreSheet.close();
    if (['modulos', 'tareas', 'clasificar', 'encargos', 'registro', 'ajustes'].includes(view))
        moreOpen.setAttribute('aria-current', 'page');
    else
        moreOpen.removeAttribute('aria-current');
    if (!TITLES[view])
        view = 'hoy';
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === `v-${view}`));
    $$('[data-view]').forEach((a) => (a.dataset.view === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    bindValue($('#title'), "textContent", () => TITLES[view]);
    if (location.hash !== `#${view}`)
        history.replaceState(null, '', `#${view}`);
    if (view === 'modulos')
        void moduleLibrary?.refresh();
    if (view === 'registro')
        renderAudit();
    if (view === 'hoy')
        renderToday();
    if (view === 'ajustes') {
        draftAgents = null;
        renderSettings();
    }
    if (view === 'asistente') {
        scrollChat();
        $('#msg').focus();
    }
}
document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-view]');
    if (!a)
        return;
    if (!S) {
        e.preventDefault();
        return;
    }
    e.preventDefault();
    go(a.dataset.view);
});
window.addEventListener('hashchange', () => {
    if (S)
        go(location.hash.slice(1));
});
async function load() {
    S = await api('/api/state');
    if (!languageInitialized) {
      languageInitialized = true;
      try { await languagePreference.initialize(); } catch(e) { bindValue($('#language-status'),'textContent',()=>tx('language.initialError',e.code||'I18N_SAVE_UNCONFIRMED')); }
      $('#language').value=getLanguage();
    }
    try {
        S.audit = await api('/api/audit');
    }
    catch {
        S.audit = [];
    }
    try {
        S.backup = await api('/api/backups');
    }
    catch {
        S.backup = null;
    }
    renderSide();
    renderToday();
    renderChat();
    renderInbox();
    renderPending();
    renderClients();
    renderTasks();
    renderErrands();
}
/* ---------------- Barra lateral ---------------- */
function aiReady() { const s = S.settings; return (s.local.enabled && s.local.model) || (s.external.enabled && s.external.model && s.privacy !== 'local-only'); }
function renderSide() {
    const s = S.settings;
    bindValue($('#biz'), "textContent", () => s.profile.business || s.profile.name || tx("app.renderSide.your_ai_workspace.aa040cf"));
    bindValue($('#c-pend'), "textContent", () => S.pending.length ? formatNumber(S.pending.length) : '');
    bindValue($('#c-tasks'), "textContent", () => S.tasks.filter((t) => !t.done).length || '');
    bindValue($('#c-today'), "textContent", () => S.inbox.filter((m) => isToday(m.created_at)).length || '');
    const b = S.backup?.last;
    bindValue($('#st-backup'), "innerHTML", () => `${icon('i-backup')}<span>${b ? `${S.backup?.scope === 'pyme1-only' ? tx("app.renderSide.rem_copy.ba3d3e4") : tx("app.renderSide.backup.8385579")}: ${esc(relDay(b.at))}, ${esc(hhmm(b.at))}` : tx("app.renderSide.no_backup_yet.73db330")}</span>`);
    const line = (on, text, title) => `<i class="dot ${on ? 'on' : ''}"></i><span title="${esc(title)}">${esc(text)}</span>`;
    bindValue($('#st-local'), "innerHTML", () => line(s.local.enabled && s.local.model, s.local.enabled && s.local.model ? tx("app.renderSide.local.06add44", s.local.model) : tx("app.renderSide.local_ai_not_configured.34805f0"), tx("app.renderSide.local_ai_ollama.0232194")));
    const ext = s.external.enabled && s.external.model && s.privacy !== 'local-only';
    bindValue($('#st-ext'), "innerHTML", () => line(ext, ext ? tx("app.renderSide.external.2ad0bfe", s.external.label || s.external.model) : tx("app.renderSide.external_ai_disabled.34b2919"), tx("app.renderSide.external_ai.41e41e6")));
    const dec = s.decision.kind !== 'none' && s.privacy !== 'local-only';
    bindValue($('#st-dec'), "innerHTML", () => line(dec, dec ? tx("app.renderSide.decision.8b75387", s.decision.model || S.presets.decision[s.decision.kind].model) : tx("app.renderSide.general_ai_classification.1c3e3d9"), tx("app.renderSide.decision_model.1e7a941")));
}
/* ---------------- Proposals (tarjetas aprobables) ---------------- */
const KINDS = localized(() => ({
    crear_tarea: { title: () => tx("app.KINDS.new_task.3e99227"), btn: tx("app.KINDS.create_task.6f541e1"), fields: [['titulo', tx("app.KINDS.task.4bc74b2")], ['fecha', tx("app.KINDS.date.99c40ab"), 'date'], ['cliente', tx("app.KINDS.client.0c77fe0")]] },
    crear_cliente: { title: () => tx("app.KINDS.new_client.7a23d01"), btn: tx("app.KINDS.create_client.cdc0e1f"), fields: [['nombre', tx("app.KINDS.name.dcd1d52")], ['email', tx("app.KINDS.email.969ccbd")], ['telefono', tx("app.KINDS.phone.63dceb8")], ['notas', tx("app.KINDS.notes.8a7525b"), 'area']] },
    anadir_nota: { title: (p) => tx("app.KINDS.note_for.a87e883", p.cliente), btn: tx("app.KINDS.add_note.63565c0"), fields: [['cliente', tx("app.KINDS.client.0c77fe0")], ['texto', tx("app.KINDS.note.d8da2c4"), 'area']] },
    redactar_mensaje: { title: (p) => tx("app.KINDS.message.d8d3c7a", p.cliente ? ` for ${p.cliente}` : ''), btn: tx("app.KINDS.save_draft.3de1001"), fields: [['cliente', tx("app.KINDS.to.f4b06ef")], ['canal', tx("app.KINDS.channel.ce4683e"), 'select', [['correo', tx("app.KINDS.email.969ccbd")], ['whatsapp', tx("app.KINDS.whatsapp.6a40edf")], ['otro', tx("app.KINDS.other.f97e9da")]]], ['asunto', tx("app.KINDS.subject.6897128")], ['texto', tx("app.KINDS.message.2f77668"), 'area']] },
    encargar: { title: (p) => tx("app.KINDS.errand_for.eee54e0", p.agente_nombre), btn: tx("app.KINDS.approve_errand.ba0ce56"), fields: [['encargo', tx("app.KINDS.errand.62baf2b"), 'area']],
        warn: (p) => tx("app.KINDS.approval_will_send_this_text.1eba010", p.agente_nombre) },
}));
const SOURCES = localized(() => ({ asistente: tx("app.SOURCES.proposed_by_your_assistant.7c61e71"), clasificador: tx("app.SOURCES.prepared_during_triage.64e86de"), 'tú': tx("app.SOURCES.prepared_by_you.1377dc2") }));
function field(p, [name, label, type, opts], locked) {
    const v = p.payload[name] ?? '';
    const dis = locked ? 'disabled' : '';
    let input;
    if (type === 'area')
        input = `<textarea name="${name}" rows="${name === 'texto' || name === 'encargo' ? 6 : 3}" ${dis}>${esc(v)}</textarea>`;
    else if (type === 'select')
        input = `<select name="${name}" ${dis}>${opts.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${val}" ${val === v ? 'selected' : ''}>${lab}</option>`; }).join('')}</select>`;
    else
        input = `<input name="${name}" type="${type || 'text'}" value="${esc(v)}" ${dis}>`;
    const hide = name === 'asunto' && p.payload.canal !== 'correo' && !v ? ' hidden' : '';
    return `<label data-f="${name}"${hide}>${label}${input}</label>`;
}
function resultHtml(p) {
    const r = p.result || {};
    const links = [...(r.links || []), ...(r.handoff?.links || [])];
    const text = r.text || r.handoff?.text;
    const resultLabel = p.kind === 'redactar_mensaje' ? tx("app.resultLabel.draft_saved.5ccb8ca") : displayText(r.message) || tx("app.resultLabel.approved.87b42e4");
    return `<span class="res">${icon('i-check')}${esc(resultLabel)}</span>
    ${links.map((l) => `<a class="btn small" href="${esc(l.href)}" target="_blank" rel="noopener">${icon('i-out')}${esc(displayText(l.label))}</a>`).join('')}
    ${text ? tx("app.resultHtml.copy_text.988283f", p.id, icon('i-copy')) : ''}`;
}
function propCard(p, { animate = false } = {}) {
    const k = KINDS[p.kind];
    if (!k)
        return '';
    animate = animate || p.id === justStamped;
    const done = p.status === 'approved', gone = p.status === 'discarded';
    const fields = k.fields;
    const grouped = p.kind === 'redactar_mensaje'
        ? `<div class="two">${field(p, fields[0], done || gone)}${field(p, fields[1], done || gone)}</div>${field(p, fields[2], done || gone)}${field(p, fields[3], done || gone)}`
        : p.kind === 'crear_tarea'
            ? `${field(p, fields[0], done || gone)}<div class="two">${field(p, fields[1], done || gone)}${field(p, fields[2], done || gone)}</div>`
            : fields.map((f) => field(p, f, done || gone)).join('');
    const foot = done ? resultHtml(p)
        : gone ? tx("app.foot.dismissed.4cad552") : tx("app.foot.dismiss.c88a0e6", p.id, p.id, icon('i-seal'), k.btn);
    const stamp = done ? `<span class="approval-badge">${p.kind === 'redactar_mensaje' ? tx("app.stamp.draft_approved.70995a4") : tx("app.stamp.proposal_approved.5f38aef")}</span>` : '';
    const kicon = p.kind === 'redactar_mensaje' ? (p.payload.canal === 'whatsapp' ? 'i-wa' : 'i-mail') : p.kind === 'crear_tarea' ? 'i-cal' : p.kind === 'crear_cliente' || p.kind === 'anadir_nota' ? 'i-people' : 'i-send';
    return `<div class="prop k-${p.kind} ${done ? 'done' : ''} ${gone ? 'discarded' : ''}" data-prop="${p.id}">
    <div class="prop-head">${icon(kicon)}${esc(k.title(p.payload))}<span class="src">${esc(SOURCES[p.source] || '')}</span>${stamp}</div>
    <div class="fields">${grouped}</div>
    ${p.kind === 'redactar_mensaje' ? warningsHtml(p.payload.avisos) + dateWarningsHtml(p.payload.avisosFecha) : ''}
    ${k.warn && !done && !gone ? `<div class="prop-warn">${icon('i-cloud')}<span>${esc(k.warn(p.payload))}</span></div>` : ''}
    <div class="prop-foot">${foot}</div>
  </div>`;
}
const allProps = () => new Map([...Object.values(S.chatProposals || {}), ...S.recent, ...S.pending].map((p) => [p.id, p]));
// El asunto solo tiene sentido en un correo.
document.addEventListener('change', (e) => {
    if (e.target.name !== 'canal')
        return;
    const card = e.target.closest('.prop');
    const f = card && $('[data-f="asunto"]', card);
    if (f)
        f.hidden = e.target.value !== 'correo' && !$('input', f).value;
});
document.addEventListener('click', async (e) => {
    const ap = e.target.closest('[data-approve]');
    const ds = e.target.closest('[data-discard]');
    const cp = e.target.closest('[data-copy]');
    if (cp) {
        const p = allProps().get(Number(cp.dataset.copy));
        if (p)
            copy(p.result?.text || p.result?.handoff?.text || '');
        return;
    }
    if (!ap && !ds)
        return;
    const btn = ap || ds;
    const card = btn.closest('.prop');
    const id = Number(btn.dataset.approve || btn.dataset.discard);
    const payload = Object.fromEntries($$('[name]', card).map((el) => [el.name, el.value]));
    btn.disabled = true;
    if (ap)
        bindValue(btn, "innerHTML", () => tx("app.extra.da0297801"));
    try {
        const p = await api(`/api/proposals/${id}/${ap ? 'approve' : 'discard'}`, { method: 'POST', body: ap ? { payload } : {} });
        S.chatProposals = { ...(S.chatProposals || {}), [p.id]: p };
        if (ap) {
            justStamped = p.id;
            setTimeout(() => { justStamped = null; }, 1500);
        }
        $$(`.prop[data-prop="${id}"]`).forEach((c) => { c.outerHTML = propCard(p, { animate: true }); });
        toast(ap ? (p.kind === 'redactar_mensaje' ? tx("app.copy.draft_saved.5ccb8ca") : p.result?.message || tx("app.copy.approved.87b42e4")) : tx("app.copy.dismissed.9d74727"));
        const fresh = await api('/api/state');
        Object.assign(S, fresh, { chatProposals: { ...fresh.chatProposals, ...S.chatProposals } });
        renderSide();
        renderPending();
        renderClients();
        renderTasks();
        renderErrands();
        renderInbox();
        renderToday();
    }
    catch (err) {
        btn.disabled = false;
        if (ap)
            bindValue(btn, "innerHTML", () => `${icon('i-seal')}${KINDS[card ? allProps().get(id)?.kind : '']?.btn || tx("app.extra.6007acbe3")}`);
        const slot = $('[data-err]', card);
        if (slot)
            bindValue(slot, "textContent", () => err.message);
        else
            toast(err.message, true);
    }
});
/* ---------------- Assistant ---------------- */
const SUGGESTIONS = localized(() => [
    tx("app.SUGGESTIONS.qu_tengo_pendiente_esta_semana.ef9c0a6"),
    tx("app.SUGGESTIONS.crea_un_cliente_marta_ruiz.aafb9c0"),
    tx("app.SUGGESTIONS.recu_rdame_llamar_a_marta.10f116b"),
    tx("app.SUGGESTIONS.redacta_un_recordatorio_amable_de.8e0884a"),
]);
function viaText(v) {
    if (!v)
        return '';
    const base = v.target === 'local' ? tx("app.base.local_ai.513ac9c", v.model) : `${v.label}, ${v.model}${v.anonymized ? tx("app.base.with_partial_anonymization.79cfc80") : ''}`;
    return `${icon(v.target === 'local' ? 'i-chip' : 'i-cloud')}<span>${esc(base)}${v.fallback ? tx('app.local.unavailable') : ''}</span>`;
}
function renderChat() {
    const box = $('#chat');
    if (!S.chat.length) {
        const p = S.settings.profile;
        bindValue(box, "innerHTML", () => tx("app.renderChat.i_can_help_organize_clients.88582f3", p.name ? tx("app.renderChat.hello.d2e32db", esc(p.name.split(' ')[0])) : tx("app.renderChat.hello.2d8bd7d"), aiReady() ? tx("app.renderChat.spanish_assistant_examples.d337982", SUGGESTIONS.map((s) => `<button class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')) : tx("app.renderChat.connect_local_ai_ollama_external.e08f22c")));
        return;
    }
    bindValue(box, "innerHTML", () => S.chat.map((m) => {
        if (m.role === 'user')
            return `<div class="msg user">${esc(m.content)}</div>`;
        const props = (m.meta?.proposals || []).map((id) => (S.chatProposals || {})[id]).filter(Boolean);
        return `<div class="msg assistant">${esc(m.content)}${props.map((p) => propCard(p)).join('')}<div class="via">${viaText(m.meta?.via)}</div></div>`;
    }).join(''));
    scrollChat();
}
function scrollChat() { const s = $('#chat-scroll'); s.scrollTop = s.scrollHeight; }
const msg = $('#msg');
const fit = () => { msg.style.height = 'auto'; msg.style.height = Math.min(200, msg.scrollHeight + 2) + 'px'; };
msg.addEventListener('input', fit);
msg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('#composer').requestSubmit();
    }
});
document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-suggest]');
    if (s) {
        msg.value = s.dataset.suggest;
        fit();
        msg.focus();
    }
});
$('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = msg.value.trim();
    if (!text)
        return;
    msg.value = '';
    fit();
    if (!S.chat.length)
        bindValue($('#chat'), "innerHTML", () => '');
    const chat = $('#chat'), preceding = chat.innerHTML;
    bindValue(chat, 'innerHTML', () => preceding + tx("app.copy.thinking.f242e09", esc(text)));
    scrollChat();
    $('#send').disabled = true;
    try {
        const r = await api('/api/chat', { method: 'POST', body: { text, prefer: $('#prefer').value || undefined, draftLanguage: $('#draft-language').value || getLanguage() } });
        S.chat.push({ role: 'user', content: text }, r.message);
        S.chatProposals = { ...(S.chatProposals || {}), ...Object.fromEntries(r.proposals.map((p) => [p.id, p])) };
        S.pending = [...r.proposals, ...S.pending];
        renderChat();
        renderSide();
        renderPending();
        renderToday();
    }
    catch (err) {
        $('#thinking')?.remove();
        bindValue($('#chat'), 'innerHTML', () => preceding + `<div class="msg user">${esc(text)}</div><div class="msg assistant"><span style="color:var(--bad)">${esc(currentUiMessage(err.message))}</span>${err.code === 'NOT_CONFIGURED' || err.code === 'UNREACHABLE' ? tx("app.copy.revisar_settings.824b0be") : ''}</div>`);
        S.chat.push({ role: 'user', content: text });
        msg.value = text;
        fit();
    }
    finally {
        $('#send').disabled = false;
        scrollChat();
    }
});
$('#clear-chat').addEventListener('click', async () => { await api('/api/chat/clear', { method: 'POST' }); S.chat = []; renderChat(); });
/* ---------------- Clasificar ---------------- */
const CAT = localized(() => ({ presupuesto: tx("app.CAT.quote.eb4cdeb"), cita: tx("app.CAT.appointment.8a4f957"), incidencia: tx("app.CAT.issue.48dc76d"), administrativo: tx("app.CAT.administration.4b42c66"), informativo: tx("app.CAT.information.1cb0ba1"), otro: tx("app.CAT.other.f97e9da") }));
const CAT_TONE = { presupuesto: 'sello', cita: 'ok', incidencia: 'bad' };
const URG = localized(() => [tx("app.URG.can_wait.c8d6d1f"), tx("app.URG.one_or_two_days.cec3b69"), tx("app.URG.today.2b065c7")]);
function decisionVia(v) {
    if (!v)
        return '';
    if (v.emulated)
        return tx("app.decisionVia.classified_by_estimated.290e5ec", v.target === 'local' ? tx("app.decisionVia.your_local_ai.c86dfb6") : v.label, v.fallbackReason ? tx('app.decision.unavailable',v.fallbackReason) : '');
    return tx("app.decisionVia.classified_with_model.f3d64f7", v.label, v.model, v.anonymized ? tx("app.decisionVia.with_partial_anonymization.79cfc80") : '');
}
function triageHtml(r) {
    const a = r.answers;
    const top = Object.entries(a.categoria.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3);
    return tx("app.triageHtml.type_urgency_reply_needed.86eb27c", esc(CAT[a.categoria.choice] || a.categoria.choice), top.map(([k, v]) => `<div class="bar"><span>${esc(CAT[k] || k)}</span><i><b style="width:${Math.round(v * 100)}%"></b></i><span>${Math.round(v * 100)} %</span></div>`).join(''), esc(URG[a.urgencia.level] || a.urgencia.label), a.urgencia.level + 1, [0, 1, 2].map((i) => `<i class="${i <= a.urgencia.level ? 'on' : ''}"></i>`).join(''), Math.round(a.responder.noul * 100), Math.round(a.responder.noul * 100), r.summary ? `<p class="summary">${esc(r.summary)}</p>` : '', icon(r.via?.target === 'local' ? 'i-chip' : 'i-bolt'), esc(decisionVia(r.via)), r.client ? tx('app.triage.client',esc(r.client.name)) : '', r.proposals.map((p) => propCard(p)).join('') || tx("app.triageHtml.no_reply_needed.0df0dde"));
}
$('#triage-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#t-text').value.trim();
    if (!text) {
        toast(tx("app.copy.paste_a_message_first.6d8a5b4"), true);
        return;
    }
    const b = $('#t-go');
    b.disabled = true;
    bindValue(b, "innerHTML", () => tx("app.extra.f184e4703"));
    bindValue($('#triage-result'), "innerHTML", () => '');
    try {
        const r = await api('/api/triage', { method: 'POST', body: { text, channel: $('#t-channel').value, draftLanguage: $('#t-draft-language').value || getLanguage(), sender: $('#t-sender').value } });
        S.chatProposals = { ...(S.chatProposals || {}), ...Object.fromEntries(r.proposals.map((p) => [p.id, p])) };
        bindValue($('#triage-result'), "innerHTML", () => triageHtml(r));
        $('#t-text').value = '';
        const fresh = await api('/api/state');
        Object.assign(S, fresh, { chatProposals: { ...fresh.chatProposals, ...S.chatProposals } });
        renderSide();
        renderPending();
        renderInbox();
        renderToday();
    }
    catch (err) {
        bindValue($('#triage-result'), "innerHTML", () => `<div class="card" style="color:var(--bad)">${esc(err.message)} ${err.code === 'NOT_CONFIGURED' ? tx("app.extra.70b13edb2") : ''}</div>`);
    }
    finally {
        b.disabled = false;
        bindValue(b, "textContent", () => tx("app.extra.7a3ef54f3"));
    }
});
function inboxRow(m) {
    const a = m.analysis?.answers;
    const client = S.clients.find((c) => c.id === m.client_id);
    const who = client?.name || m.sender || tx("app.who.no_sender.c0263cd");
    const props = (m.analysis?.proposals || []).map((id) => allProps().get(id)).filter(Boolean);
    const cat = a?.categoria?.choice;
    const lvl = a ? a.urgencia.level : -1;
    const quiet = a && (cat === 'otro' || cat === 'informativo') && !props.length;
    const msgP = props.find((p) => p.kind === 'redactar_mensaje'), taskP = props.find((p) => p.kind === 'crear_tarea');
    const state = msgP ? (msgP.status === 'approved' ? [icon('i-check'), tx("app.state.draft_saved.5ccb8ca"), 'ok'] : msgP.status === 'discarded' ? ['', tx("app.state.reply_descartada.2b8c38c"), ''] : [icon('i-seal'), tx("app.state.draft_prepared.1b07d71"), 'ready'])
        : taskP ? [icon('i-list'), taskP.status === 'approved' ? tx("app.state.task_created.a3e3e96") : tx("app.state.proposed_task.3da6a51"), '']
            : cat === 'otro' ? [icon('i-archive'), tx("app.state.archivado.eac5386"), ''] : a ? ['', tx("app.state.no_necesita_respuesta.aacb668"), ''] : ['', '', ''];
    const ch = m.channel === 'whatsapp' ? 'i-wa' : m.channel === 'correo' ? 'i-mail' : 'i-chat';
    return `<div class="mrow${quiet ? ' dim' : ''}${lvl === 2 ? ' hot' : ''}">
    <div class="av">${esc(initials(who))}<span class="ch ${esc(m.channel)}">${icon(ch)}</span></div>
    <div class="mmid"><div class="mtop"><b>${esc(who)}</b><time>${esc(isToday(m.created_at) ? hhmm(m.created_at) : fmtDate(m.created_at))}</time></div>
      <div class="msum">${esc(m.analysis?.summary || m.text)}</div>
      ${a ? `<div class="mtags"><span class="pill ${CAT_TONE[cat] || ''}">${esc(CAT[cat] || cat)}</span>${lvl > 0 ? tx("app.inboxRow.urgency.43b587e", lvl + 1, esc(URG[lvl])) : ''}</div>` : ''}</div>
    <div class="mright"><span class="state ${state[2]}">${state[0]}${esc(state[1])}</span>${S.awosIntakesEnabled ? tx("app.inboxRow.review_awos_contact.4d2c59e", m.id) : ''}</div>
  </div>`;
}
function renderInbox() {
    bindValue($('#inbox-list'), "innerHTML", () => S.inbox.length ? S.inbox.map(inboxRow).join('')
        : tx("app.renderInbox.no_classified_messages_yet_messages.df2dfd4"));
}
/* ---------------- Today ---------------- */
const EXTERNAL = ['ia_externa', 'decision_externa', 'encargo_externo'];
function renderToday() {
    if (!S)
        return;
    const p = S.settings.profile, h = Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'numeric',hourCycle:'h23'}).format(new Date()));
    const hello = () => h < 14 ? tx("app.hello.good_morning.90a90a4") : h < 21 ? tx("app.hello.good_afternoon.d325e1b") : tx("app.hello.good_evening.15a421e");
    const todayLabel = () => formatDate(new Date(),{weekday:'long',day:'numeric',month:'long'});
    bindValue($('#today-date'), "textContent", () => todayLabel().charAt(0).toUpperCase() + todayLabel().slice(1));
    bindValue($('#hello'), "textContent", () => p.name ? `${hello()}, ${p.name.split(' ')[0]}` : hello());
    const todays = S.inbox.filter((m) => isToday(m.created_at));
    const replies = S.pending.filter((x) => x.kind === 'redactar_mensaje').length;
    const tasksP = S.pending.filter((x) => x.kind === 'crear_tarea').length;
    const n = (k, one, many) => `<b>${formatNumber(k)} ${k === 1 ? one : many}</b>`;
    bindValue($('#today-sum'), "innerHTML", () => todays.length || S.pending.length
        ? tx("app.renderToday.you_decide_what_happens_to.dc9104d", todays.length ? tx("app.renderToday.today_received_for_classification.cb7f5ad", n(todays.length, tx("app.renderToday.message.ab530a1"), tx("app.renderToday.messages.f5cccfb"))) : '', S.pending.length ? tx("app.renderToday.awaiting_review_to_review.ba15ed1", n(replies, tx("app.renderToday.reply.5782b18"), tx("app.renderToday.replies.b994278")), tasksP ? tx("common.andValue", n(tasksP, tx("app.renderToday.task.0ebb429"), tx("app.renderToday.tasks.0851540"))) : '') : tx("app.renderToday.nothing_is_awaiting_approval.7018d72")) : tx("app.renderToday.all_caught_up_paste_a.b9eb622"));
    const out = (S.audit || []).filter((r) => EXTERNAL.includes(r.kind) && isToday(r.at)).length;
    $('#privacy').className = `privacy${out ? ' warn' : ''}`;
    bindValue($('#privacy'), "innerHTML", () => `${icon(out ? 'i-cloud' : 'i-shield')}<div><strong>${out ? tx("app.renderToday.external_recorded_today.2ab6e24", out, out === 1 ? tx('common.request') : tx('common.requests')) : tx("app.renderToday.processed_on_this_mac.ebe0f56")}</strong><span>${out ? tx("app.renderToday.check_the_activity_log_for.b5330c1") : tx("app.renderToday.no_client_data_has_left.fd48585")}</span></div>`);
    const recent = S.inbox.slice(0, 7);
    bindValue($('#today-inbox'), "innerHTML", () => recent.length ? recent.map(inboxRow).join('')
        : tx("app.renderToday.no_messages_yet_paste_an.e6ed3ec"));
    const stamped = S.recent.filter((x) => x.status === 'approved' && isToday(x.decided_at)).slice(0, 1);
    const cards = S.pending.slice(0, 4);
    const waiting = S.tasks.filter(t => !t.done);
    bindValue($('#today-overview'), "innerHTML", () => [
        ['i-seal', S.pending.length, tx("app.renderToday.need_your_review.c41d69d"), tx("app.renderToday.message.216965e", replies, replies === 1 ? tx("app.renderToday.draft.7743ce3") : tx("app.renderToday.drafts.bd949e8")), 'aprobaciones'],
        ['i-tray', todays.length, tx("app.renderToday.today_s_messages.163fce2"), tx("app.renderToday.review_client_messages.0f2d705"), 'clasificar'],
        ['i-cal', waiting.length, tx("app.renderToday.pending_tasks.47b14c5"), tx("app.renderToday.due_today_or_earlier.6cd2a10", waiting.filter(t => t.due && t.due <= new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'})).length), 'tareas'],
        ['i-people', S.clients.length, tx("app.renderToday.clients_in_your_workspace.dfec6cf"), tx("app.renderToday.contacts_and_notes_on_this.5d28e3a"), 'clientes'],
    ].map(([symbol, total, label, detail, view]) => `<a class="metric-card" href="#${view}" data-view="${view}"><div class="metric-top"><span class="metric-icon">${icon(symbol)}</span><span>${esc(label)}</span></div><strong>${formatNumber(total)}</strong><small>${esc(detail)}</small></a>`).join(''));
    bindValue($('#today-review'), "textContent", () => S.pending.length ? tx("app.renderToday.review.6742f83", S.pending.length, S.pending.length === 1 ? tx('common.proposal') : tx('common.proposals')) : tx("app.renderToday.request_a_draft.f291c26"));
    $('#today-review').dataset.view = S.pending.length ? 'aprobaciones' : 'asistente';
    $('#today-review').href = S.pending.length ? '#aprobaciones' : '#asistente';
    const dueFollowups = S.awosFollowups ?? [];
    const upcoming = [...waiting].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, Math.max(0, 4 - dueFollowups.length));
    bindValue($('#today-next'), "innerHTML", () => upcoming.length ? upcoming.map(t => `<li><div><strong>${esc(t.title)}</strong>${t.client_name ? `<span>${esc(t.client_name)}</span>` : ''}</div><time>${esc(t.due ? formatDate(t.due+'T12:00:00',{weekday:'short',day:'numeric',month:'short'}) : tx("app.renderToday.no_date.4214c2f"))}</time></li>`).join('') : tx("app.renderToday.no_pending_tasks_your_task.eff34f6"));
    if (dueFollowups.length)
        prependLocalized($('#today-next'), () => dueFollowups.map(f => tx("app.renderToday.pending_follow_up_open.ffe688c", esc(f.note || tx("app.renderToday.proposal_approved.5f38aef")))).join(''));
    $('#today-approved-section').hidden = !stamped.length;
    bindValue($('#today-approved'), "innerHTML", () => stamped.map(p => `<details class="review-detail"><summary><span>${esc(KINDS[p.kind]?.title(p.payload) || tx("app.renderToday.proposal.5d42766"))}</span><span class="pill ok">${p.kind === 'redactar_mensaje' ? tx("app.renderToday.draft_approved.70995a4") : tx("app.renderToday.approved.87b42e4")}</span></summary>${propCard(p)}</details>`).join(''));
    bindValue($('#today-pend'), "textContent", () => S.pending.length ? tx("app.renderToday.pending.cb4a564", S.pending.length) : tx("app.renderToday.all_caught_up.7773db0"));
    bindValue($('#today-props'), "innerHTML", () => cards.length ? cards.map((x) => {
        const target = x.payload.cliente || x.payload.nombre || '';
        const contact = S.clients.find(c => c.name === target);
        const title = x.kind === 'redactar_mensaje' ? target || tx("app.title.recipient_needs_review.2d94b2e") : x.payload.titulo || KINDS[x.kind]?.title(x.payload) || tx("app.title.proposal.5d42766");
        const channel = x.kind === 'redactar_mensaje' ? (x.payload.canal === 'correo' ? tx("app.channel.email.969ccbd") : x.payload.canal === 'whatsapp' ? tx("app.channel.whatsapp.6a40edf") : tx("app.channel.other_channel.75621ba")) : tx("app.channel.proposed_task.3da6a51");
        const preview = x.payload.texto || x.payload.notas || (x.kind === 'crear_tarea' ? tx("app.preview.awaiting_creation.a9403ed", target ? ` · ${target}` : '') : tx("app.preview.open_the_proposal_to_review.41f078e"));
        return tx("app.renderToday.open_proposal.516c12b", esc(initials(target || title)), esc(title), esc(contact?.email || target || channel), esc(channel), x.payload.asunto ? `<span class="review-subject">${esc(x.payload.asunto)}</span>` : '', esc(preview.slice(0, 200)), preview.length > 200 ? '…' : '', x.payload.avisos?.length ? tx("app.renderToday.review_numbers_before_approving.c450c8b") : tx("app.renderToday.awaiting_your_review.33cbccb"), propCard(x));
    }).join('') : tx("app.renderToday.no_pending_proposals_ask_your.5bd0228"));
}
/* ---------------- Aprobaciones ---------------- */
function renderPending() {
    bindValue($('#pending'), "innerHTML", () => S.pending.length ? S.pending.map((p) => propCard(p)).join('')
        : tx("app.renderPending.all_caught_up_proposals_from.376fe1c"));
    bindValue($('#recent'), "innerHTML", () => S.recent.map((p) => `<li><div><div class="t">${esc(KINDS[p.kind]?.title(p.payload) || p.kind)}</div><div class="m">${esc(fmtDate(p.decided_at))}</div></div>
    <div class="r"><span class="pill ${p.status === 'approved' ? 'ok' : ''}">${p.status === 'approved' ? tx("app.renderPending.approved.87b42e4") : tx("app.renderPending.dismissed.9d74727")}</span></div></li>`).join('')
        || tx("app.renderPending.no_decisions_yet_approved_and.dfe4e5b"));
}
/* ---------------- Clients ---------------- */
function renderClients() {
    const qy = ($('#c-search')?.value || '').trim().toLowerCase();
    const list = S.clients.filter((c) => !qy || [c.name, c.email, c.phone, c.notes].join(' ').toLowerCase().includes(qy)).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    bindValue($('#clients-count'), "textContent", () => qy ? tx("app.extra.fac825032",formatNumber(list.length),formatNumber(S.clients.length)) : formatNumber(S.clients.length));
    const openTasks = (id) => S.tasks.filter((t) => !t.done && t.client_id === id);
    bindValue($('#clients'), "innerHTML", () => list.length ? list.map((c) => {
        const tk = openTasks(c.id), next = tk.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
        return tx("app.renderClients.cancel_save_notes_notes.8fbe971", c.id, esc(initials(c.name)), esc(c.name), tk.length ? `${formatNumber(tk.length)} ${tk.length === 1 ? tx("app.renderClients.task.0ebb429") : tx("app.renderClients.tasks.0851540")}${next ? tx("app.renderClients.next.1101fc0", esc(fmtDay(next.due))) : ''}` : tx("app.renderClients.no_pending_tasks.c6fabfb"), c.email ? `<span>${esc(c.email)}</span>` : '', c.phone ? `<span class="faint">${esc(c.phone)}</span>` : '', !c.email && !c.phone ? tx("app.renderClients.no_contact_details.6d55af9") : '', c.notes ? esc(c.notes.slice(0, 160)) : tx("app.renderClients.no_notes.d3cab62"), esc(c.notes), c.id, c.id, esc(c.name), icon('i-trash'));
    }).join('') : `<tr><td colspan="4"><div class="empty-state"><div><h3>${qy ? tx("app.renderClients.no_matching_clients.a155228") : tx("app.renderClients.no_clients_yet.1589f65")}</h3><p>${qy ? tx("app.renderClients.try_another_name_email_or.eab670c") : tx("app.renderClients.add_one_below_or_ask.5930db2")}</p></div></div></td></tr>`);
    bindValue($('#k-client'), "innerHTML", () => tx("app.renderClients.ninguno.4388e4d", S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')));
}
$('#c-search').addEventListener('input', renderClients);
$('#client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await api('/api/clients', { method: 'POST', body: { name: $('#c-name').value, email: $('#c-email').value, phone: $('#c-phone').value } });
        e.target.reset();
        S = { ...S, ...(await api('/api/state')) };
        renderClients();
        toast(tx("app.copy.client_added.789ec7d"));
    }
    catch (err) {
        toast(err.message, true);
    }
});
document.addEventListener('click', async (e) => {
    const li = e.target.closest('[data-client]');
    if (!li)
        return;
    if (e.target.closest('[data-edit-notes]')) {
        $('.notes-edit', li).hidden = false;
        $('textarea', li).focus();
    }
    if (e.target.closest('[data-cancel-notes]'))
        $('.notes-edit', li).hidden = true;
    const save = e.target.closest('[data-save-notes]');
    if (save) {
        await api(`/api/clients/${save.dataset.saveNotes}`, { method: 'PUT', body: { notes: $('textarea', li).value } });
        S = { ...S, ...(await api('/api/state')) };
        renderClients();
        toast(tx("app.copy.notes_saved.c025c3c"));
    }
    const del = e.target.closest('[data-del-client]');
    if (del) {
        if (del.dataset.confirm !== '1') {
            del.dataset.confirm = '1';
            bindValue(del, "innerHTML", () => tx("app.extra.74ad148c6"));
            setTimeout(() => {
                if (del.isConnected) {
                    del.dataset.confirm = '';
                    bindValue(del, "innerHTML", () => icon('i-trash'));
                }
            }, 3000);
            return;
        }
        await api(`/api/clients/${del.dataset.delClient}`, { method: 'DELETE' });
        S = { ...S, ...(await api('/api/state')) };
        renderClients();
        renderTasks();
        toast(tx("app.copy.client_deleted.c8b004b"));
    }
});
/* ---------------- Tasks ---------------- */
function renderTasks() {
    const today = new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Madrid'});
    const qy = ($('#task-search')?.value || '').trim().toLowerCase(), filter = $('#task-filter')?.value || 'open';
    const tasks = S.tasks.filter(t => (filter === 'all' || (filter === 'done') === !!t.done) && (!qy || [t.title, t.client_name].join(' ').toLowerCase().includes(qy))).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }));
    bindValue($('#tasks-count'), "textContent", () => tx("app.extra.fac825032",formatNumber(tasks.length),formatNumber(S.tasks.length)));
    bindValue($('#tasks'), "innerHTML", () => tasks.length ? tasks.map((t) => `<li>
    <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''} style="margin-top:3px;accent-color:var(--sello)">
      <span><span class="t" style="${t.done ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${esc(t.title)}</span>${t.client_name ? `<span class="m" style="display:block">${esc(t.client_name)}</span>` : ''}</span></label>
    <div class="r">${t.due ? `<span class="pill ${!t.done && t.due < today ? 'bad' : !t.done && t.due === today ? 'warn' : ''}">${!t.done && t.due < today ? tx("app.renderTasks.vencida.3ba71db") : ''}${esc(formatDate(t.due+'T12:00:00',{weekday:'short',day:'numeric',month:'short'}))}</span>` : ''}
      <button class="btn small ghost" data-del-task="${t.id}" aria-label="Delete task: ${esc(t.title)}">${icon('i-trash')}</button></div></li>`).join('')
        : `<li class="empty-state"><div><h3>${S.tasks.length ? tx("app.renderTasks.no_matching_tasks.ff36d18") : tx("app.renderTasks.no_tasks.9c2f474")}</h3><p>${S.tasks.length ? tx("app.renderTasks.try_another_search_or_filter.1441bc9") : tx("app.renderTasks.add_a_task_here_or.147e4b1")}</p></div></li>`);
}
$('#task-search').addEventListener('input', renderTasks);
$('#task-filter').addEventListener('change', renderTasks);
$('#task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await api('/api/tasks', { method: 'POST', body: { title: $('#k-title').value, due: $('#k-due').value, client_id: $('#k-client').value || null } });
        e.target.reset();
        S = { ...S, ...(await api('/api/state')) };
        renderTasks();
        renderSide();
    }
    catch (err) {
        toast(err.message, true);
    }
});
document.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-task]');
    if (!t)
        return;
    await api(`/api/tasks/${t.dataset.task}`, { method: 'PUT', body: { done: t.checked } });
    S = { ...S, ...(await api('/api/state')) };
    renderTasks();
    renderSide();
});
document.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del-task]');
    if (!d)
        return;
    await api(`/api/tasks/${d.dataset.delTask}`, { method: 'DELETE' });
    S = { ...S, ...(await api('/api/state')) };
    renderTasks();
    renderSide();
});
/* ---------------- Errands ---------------- */
const ERRAND_STATE = localized(() => ({ entregar_a_mano: [tx("app.ERRAND_STATE.for_manual_delivery.8c382af"), 'warn'], enviado: [tx("app.ERRAND_STATE.sent.c16bc82"), 'sello'], respondido: [tx("app.ERRAND_STATE.replied.1cd7fa9"), 'ok'], necesita_info: [tx("app.ERRAND_STATE.requests_more_information.a19dac9"), 'warn'], fallido: [tx("app.ERRAND_STATE.failed.031a8f0"), 'bad'], cerrado: [tx("app.ERRAND_STATE.closed.c21ead0"), ''] }));
function handoffLinks(agent, brief) {
    const enc = encodeURIComponent(brief), digits = (agent.handle || '').replace(/\D/g, ''), out = [];
    if (agent.app === 'whatsapp' && digits)
        out.push({ label: tx("app.handoffLinks.open_in_whatsapp.67d0a8e"), href: `https://wa.me/${digits}?text=${enc}` });
    if (agent.app === 'imessage' && agent.handle)
        out.push({ label: tx("app.handoffLinks.open_in_messages.661d26a"), href: `sms:${agent.handle}&body=${enc}` });
    if (agent.openUrl)
        out.push({ label: tx("app.handoffLinks.open.2635a35", agent.name), href: agent.openUrl });
    return out;
}
function renderErrands() {
    const agents = S.settings.agents;
    const qy = ($('#errand-search')?.value || '').trim().toLowerCase();
    const errands = S.errands.filter(e => !qy || [e.agent_name, e.brief, e.response, ERRAND_STATE[e.status]?.[0]].join(' ').toLowerCase().includes(qy)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    bindValue($('#errands-count'), "textContent", () => qy ? tx("app.extra.fac825032", errands.length, S.errands.length) : formatNumber(S.errands.length));
    bindValue($('#e-agent'), "innerHTML", () => agents.length ? agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('') : tx("app.renderErrands.add_an_agent_in_settings.1bffbd6"));
    $('#errand-form button').disabled = !agents.length;
    bindValue($('#errands'), "innerHTML", () => errands.length ? errands.map((e) => {
        const agent = agents.find((a) => a.id === e.agent_id);
        const [label, tone] = ERRAND_STATE[e.status] || [e.status, ''];
        const manual = agent?.kind === 'chat' && e.status === 'entregar_a_mano';
        return tx("app.renderErrands.cancel_save_reply.b58a0ae", e.id, esc(e.agent_name), esc(e.brief.slice(0, 400)), esc(fmtDate(e.created_at)), e.response ? tx("app.renderErrands.reply_ask_my_assistant_to.f7d5004", esc(e.response), e.id, icon('i-chat')) : '', esc(e.agent_name), esc(e.response), e.id, tone, esc(label), manual ? tx("app.renderErrands.copy.cf3cf2b", e.id, icon('i-copy'), handoffLinks(agent, e.brief).map((l) => `<a class="btn small" href="${esc(l.href)}" target="_blank" rel="noopener">${icon('i-out')}${esc(displayText(l.label))}</a>`).join('')) : '', agent?.kind === 'a2a' && e.remote_id && ['enviado', 'necesita_info'].includes(e.status) ? tx("app.renderErrands.refresh.b1c1a0f", e.id) : '', e.status !== 'cerrado' ? `<button class="btn small ghost" data-edit-resp>${e.response ? tx("app.renderErrands.edit_reply.cecc822") : tx("app.renderErrands.paste_reply.ca1ed69")}</button>` : '');
    }).join('') : `<li class="empty-state"><div><h3>${S.errands.length ? tx("app.renderErrands.no_matching_errands.7f5becc") : tx("app.renderErrands.no_errands.44f6abc")}</h3><p>${S.errands.length ? tx("app.renderErrands.try_another_search.06cf1d8") : tx("app.renderErrands.prepare_one_above_or_ask.13b20fb")}</p></div></li>`);
}
$('#errand-search').addEventListener('input', renderErrands);
$('#errand-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const p = await api('/api/errands', { method: 'POST', body: { agent: $('#e-agent').value, brief: $('#e-brief').value } });
        S.chatProposals = { ...(S.chatProposals || {}), [p.id]: p };
        S.pending = [p, ...S.pending];
        bindValue($('#errand-new'), "innerHTML", () => propCard(p));
        $('#e-brief').value = '';
        renderSide();
        renderPending();
    }
    catch (err) {
        toast(err.message, true);
    }
});
document.addEventListener('click', async (e) => {
    const li = e.target.closest('[data-errand]');
    if (!li)
        return;
    const id = Number(li.dataset.errand), er = S.errands.find((x) => x.id === id);
    try {
        if (e.target.closest('[data-copy-brief]'))
            copy(er.brief);
        if (e.target.closest('[data-edit-resp]')) {
            $('.resp-edit', li).hidden = false;
            $('textarea', li).focus();
        }
        if (e.target.closest('[data-cancel-resp]'))
            $('.resp-edit', li).hidden = true;
        if (e.target.closest('[data-save-resp]')) {
            await api(`/api/errands/${id}/response`, { method: 'POST', body: { response: $('.resp-edit textarea', li).value } });
            S = { ...S, ...(await api('/api/state')) };
            renderErrands();
            toast(tx("app.copy.reply_guardada.8942477"));
        }
        if (e.target.closest('[data-refresh]')) {
            await api(`/api/errands/${id}/refresh`, { method: 'POST' });
            S = { ...S, ...(await api('/api/state')) };
            renderErrands();
            toast(tx("app.copy.actualizado.8b0062f"));
        }
        if (e.target.closest('[data-analyze]')) {
            go('asistente');
            msg.value = tx("app.extra.3f513d8a7", er.agent_name, er.brief.slice(0, 120), er.response);
            fit();
            msg.focus();
        }
    }
    catch (err) {
        toast(err.message, true);
    }
});
/* ---------------- Registro ---------------- */
const AUDIT = localized(() => ({ ia_externa: tx("app.AUDIT.external_ai_request.90d3276"), decision_externa: tx("app.AUDIT.external_model_classification.0f6f457"), encargo_externo: tx("app.AUDIT.errand_for_another_agent.02b416c"), mensaje_aprobado: tx("app.AUDIT.draft_saved.5ccb8ca"), clave: tx("app.AUDIT.api_key_saved.934b6af") }));
async function renderAudit() {
    const rows = S.audit = await api('/api/audit');
    const outToday = rows.filter((r) => EXTERNAL.includes(r.kind) && isToday(r.at)).length;
    const week = Date.now() - 7 * 864e5;
    const outWeek = rows.filter((r) => EXTERNAL.includes(r.kind) && Date.parse(r.at) > week).length;
    const approved = S.recent.filter((p) => p.status === 'approved').length;
    bindValue($('#audit-zero'), "innerHTML", () => tx("app.renderAudit.external_data_recorded_today_messages.2987415", outToday ? 'warn' : '', outToday, outToday === 1 ? tx('common.request') : tx('common.requests'), S.inbox.length, outWeek, approved));
    const qy = ($('#audit-search')?.value || '').trim().toLowerCase();
    const shown = rows.filter(r => !qy || [AUDIT[r.kind] || r.kind, r.target, r.detail].join(' ').toLowerCase().includes(qy));
    bindValue($('#audit-count'), "textContent", () => qy ? tx("app.extra.fac825032", shown.length, rows.length) : formatNumber(rows.length));
    bindValue($('#audit'), "innerHTML", () => { let last = ''; return shown.length ? shown.map((r) => {
        const k = dayKey(r.at), head = k !== last ? `<li class="dayrow"><div class="day">${esc(cap(relDay(r.at)))}</div></li>` : '';
        last = k;
        const out = EXTERNAL.includes(r.kind);
        return `${head}<li><time>${esc(hhmm(r.at))}</time><span class="node ${out ? 'out' : 'ok'}">${icon(out ? 'i-out' : r.kind === 'mensaje_aprobado' ? 'i-seal' : 'i-lock')}</span>
      <div><b>${esc(AUDIT[r.kind] || r.kind)}${r.target ? ` · ${esc(r.target)}` : ''}</b>${r.detail ? `<div class="d">${esc(r.detail)}</div>` : ''}</div></li>`;
    }).join('') : `<li class="dayrow"><div class="empty-state"><div><h3>${rows.length ? tx("app.renderAudit.no_matching_activity.5c8e648") : tx("app.renderAudit.no_external_activity_recorded.2be6a1e")}</h3><p>${rows.length ? tx("app.renderAudit.try_another_search.06cf1d8") : tx("app.renderAudit.this_list_stays_empty_while.3a98218")}</p></div></div></li>`; });
}
$('#audit-search').addEventListener('input', () => renderAudit().catch(err => toast(err.message, true)));
/* ---------------- Settings ---------------- */
function modelOptions(list, current) {
    const ids = [...new Set([current, ...list.map((m) => m.id)].filter(Boolean))];
    return ids.length ? ids.map((id) => `<option ${id === current ? 'selected' : ''}>${esc(id)}</option>`).join('') : tx("app.modelOptions.choose_load_models.5904e39");
}
const sel = (name, value, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const keyState = (has) => has ? tx("app.keyState.stored_in.2f220aa", esc(displayText(S.settings.secretsWhere))) : tx("app.keyState.no_key.e07edff");
function renderSettings() {
    const s = S.settings;
    if (!draftAgents)
        draftAgents = s.agents.map((a) => ({ ...a }));
    const routeOpts = localized(() => [['auto', tx("app.routeOpts.automatic.d461a49")], ['local', tx("app.routeOpts.local_ai_only.58e8786")], ['external', tx("app.routeOpts.external_ai.41e41e6")]]);
    const dp = S.presets.decision;
    bindValue($('#settings'), "innerHTML", () => tx("app.renderSettings.settings_settings_set_up_your.28106d1", icon('i-lock'), esc(displayText(s.secretsWhere)), esc(s.profile.name), esc(s.profile.business), esc(s.profile.sector), esc(s.profile.tone), icon('i-chip'), s.local.enabled ? 'checked' : '', esc(s.local.url), modelOptions(loadedModels.local, s.local.model), icon('i-cloud'), s.external.enabled ? 'checked' : '', sel('preset', S.presets.external.find((p) => p.baseUrl === s.external.baseUrl && p.kind === s.external.kind)?.id || 'custom', S.presets.external.map((p) => [p.id, displayText(p.label)])), esc(s.external.baseUrl), sel('kind', s.external.kind, [['openai', tx("app.renderSettings.openai_compatible.52b5266")], ['anthropic', tx("app.renderSettings.anthropic.744205e")]]), esc(s.external.model), loadedModels.external.map((m) => `<option value="${esc(m.id)}">`).join(''), keyState(s.keys.external), icon('i-bolt'), sel('kind', s.decision.kind, [['none', tx("app.renderSettings.none_use_general_ai.5973506")], ['typesafe', dp.typesafe.label], ['openrouter', tx("app.renderSettings.jev_clef.9c49d2e", dp.openrouter.label)], ['custom', tx("app.renderSettings.compatible_custom_server.40fd8c3")]]), esc(s.decision.model), esc(dp[s.decision.kind]?.model || ''), s.decision.kind === 'custom' ? '' : 'hidden', esc(s.decision.url), keyState(s.keys.decision), icon('i-lock'), sel('chat', s.routing.chat, routeOpts), sel("draft", s.routing.draft, routeOpts), sel('triage', s.routing.triage, routeOpts), [['anonymize', tx("app.renderSettings.anonimizar.9352fe7"), tx("app.renderSettings.names_emails_phone_numbers_spanish.329d658")],
        ['allow', tx("app.renderSettings.send_unchanged.14cbf92"), tx("app.renderSettings.the_external_provider_will_receive.bc74981")],
        ['local-only', tx("app.renderSettings.keep_ai_processing_on_this.44b5ea4"), tx("app.renderSettings.only_local_ai_is_used.daeadbf")]]
        .map(([v, t, d]) => `<label class="radio"><input type="radio" name="privacy" value="${v}" ${s.privacy === v ? 'checked' : ''}><span><b>${t}</b><span>${d}</span></span></label>`).join(''), icon('i-send'), draftAgents.map((a, i) => agentForm(a, i, s.keys.agents[a.id])).join('') || tx("app.renderSettings.no_agents_added_yet.8ab7048"), S.presets.agents.map((p, i) => `<option value="${i}">${esc(displayText(p.name))}</option>`).join(''), icon('i-plus'), S.backup?.scope === 'pyme1-only' ? tx("app.renderSettings.these_backups_cover_rem_only.dfcc0e6") : ''));
    refreshBackupStatus();
    refreshModelWarning();
    loadModelCapacity();
}
function refreshModelWarning() {
    const form = $('[data-sec="local"]'), slot = $('[data-model-warning]');
    if (!form || !slot)
        return;
    const metadata = form.url.value === loadedLocalUrl ? loadedModels.local.find(m => m.id === form.model.value) : null;
    const warning = smallModelWarning(form.model.value, metadata || {});
    bindValue(slot, "textContent", () => warning);
    slot.hidden = !warning;
}
async function loadModelCapacity() {
    const url = S.settings.local.url;
    if (loadedLocalUrl === url || capacityRequest?.url === url)
        return;
    const request = { url };
    capacityRequest = request;
    try {
        const models = await api('/api/models/local');
        if (capacityRequest !== request || S.settings.local.url !== url)
            return;
        loadedModels.local = models;
        loadedLocalUrl = url;
        // No reconstruimos el formulario: preservar cambios que aún no se han guardado.
        refreshModelWarning();
    }
    catch { /* Si Ollama no responde, la inferencia por nombre sigue funcionando. */ }
    finally {
        if (capacityRequest === request)
            capacityRequest = null;
    }
}
async function refreshBackupStatus() {
    try {
        const b = await api('/api/backups');
        const slot = $('#backup-status');
        if (!slot)
            return;
        bindValue(slot, "textContent", () => (b.notice ? displayText(b.notice) + ' ' : '') + (b.error || (b.last ? tx("app.refreshBackupStatus.latest_backup_of_dates_retained.00e730d", fmtDate(b.last.at), b.count, b.retention) : tx("app.refreshBackupStatus.no_backups_yet.0d123d0"))));
        $('#backup-reveal').disabled = !b.last;
    }
    catch (err) {
        const slot = $('#backup-status');
        if (slot)
            bindValue(slot, "textContent", () => err.message);
    }
}
function agentForm(a, i, hasKey) {
    const api = a.kind === 'a2a' || a.kind === 'webhook';
    return tx("app.agentForm.name_connection_method_test_connection.bcc5e8e", i, esc(a.name), sel('kind', a.kind, [['chat', tx("app.agentForm.opening_the_app_no_api.80e6d49")], ['a2a', tx("app.agentForm.api_a2a.958aad4")], ['webhook', tx("app.agentForm.webhook.4814f62")]]), api ? tx("app.agentForm.api_address.5c4e096") : tx("app.agentForm.app.0d04bfe"), api ? `<input name="url" value="${esc(a.url)}" placeholder="https://…">` : sel('app', a.app, [['imessage', 'iMessage'], ['whatsapp', tx("app.agentForm.whatsapp.6a40edf")], ['web', tx("app.agentForm.website_or_app.0c39dd9")]]), api ? '' : tx("app.agentForm.contact_phone_or_handle_opening.bbfd483", esc(a.handle), esc(a.openUrl)), a.notes ? `<p class="help">${esc(a.notes)}</p>` : '', api ? tx("app.agentForm.save_key.27a40b9", keyState(hasKey), i) : '<span class="note"></span>', i, i, icon('i-trash'));
}
function readAgents() {
    $$('[data-agent]').forEach((f) => {
        const a = draftAgents[Number(f.dataset.agent)];
        for (const el of $$('[name]', f))
            a[el.name] = el.value;
    });
}
const settingsBox = $('#settings');
settingsBox.addEventListener('change', (e) => {
    const f = e.target.closest('form');
    if (f?.dataset.sec === 'local')
        refreshModelWarning();
    if (e.target.name === 'preset' && f?.dataset.sec === 'external') {
        const p = S.presets.external.find((x) => x.id === e.target.value);
        if (p) {
            f.baseUrl.value = p.baseUrl;
            f.kind.value = p.kind;
        }
    }
    if (e.target.name === 'kind' && f?.dataset.sec === 'decision') {
        $('[data-custom]', f).hidden = e.target.value !== 'custom';
        f.model.placeholder = S.presets.decision[e.target.value]?.model || '';
    }
    if (e.target.name === 'kind' && e.target.closest('[data-agent]')) {
        readAgents();
        renderSettings();
    }
});
async function saveSection(f) {
    const sec = f.dataset.sec;
    let body;
    if (sec === 'profile')
        body = { profile: { name: f.name.value, business: f.business.value, sector: f.sector.value, tone: f.tone.value } };
    if (sec === 'local')
        body = { local: { enabled: f.enabled.checked, url: f.url.value, model: f.model.value } };
    if (sec === 'external') {
        const preset = S.presets.external.find((p) => p.id === f.preset.value);
        body = { external: { enabled: f.enabled.checked, kind: f.kind.value, baseUrl: f.baseUrl.value, model: f.model.value, label: preset && preset.id !== 'custom' ? preset.label : '' } };
    }
    if (sec === 'decision')
        body = { decision: { kind: f.kind.value, model: f.model.value, url: f.url.value } };
    if (sec === 'usage')
        body = { routing: { chat: f.chat.value, draft: f.draft.value, triage: f.triage.value }, privacy: f.privacy.value };
    S.settings = await api('/api/settings', { method: 'POST', body });
    renderSide();
    renderChat();
}
settingsBox.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await saveSection(e.target);
        toast(tx("app.copy.guardado.3a660ff"));
        renderSettings();
        renderChat();
    }
    catch (err) {
        toast(err.message, true);
    }
});
settingsBox.addEventListener('click', async (e) => {
    const f = e.target.closest('form');
    const out = (msg, ok) => {
        const o = $('[data-out]', e.target.closest('.form') || f || settingsBox);
        if (o) {
            bindValue(o, "textContent", () => currentUiMessage(msg));
            o.className = ['note', 'test-out', ok ? 'ok' : 'bad'].join(' ');
        }
    };
    try {
        const backupButton = e.target.closest('#backup-now, #backup-reveal');
        if (backupButton) {
            backupButton.disabled = true;
            try {
                await api(backupButton.id === 'backup-now' ? '/api/backups' : '/api/backups/reveal', { method: 'POST', body: {} });
                toast(backupButton.id === 'backup-now' ? tx("app.copy.backup_saved.3252d55") : tx("app.copy.backup_shown_in_finder.08c5d47"));
            }
            finally {
                backupButton.disabled = false;
                await refreshBackupStatus();
            }
            return;
        }
        const demo = e.target.closest('#load-demo');
        if (demo) {
            const force = demo.dataset.confirm === '1';
            demo.disabled = true;
            try {
                await api('/api/demo', { method: 'POST', body: { forzar: force } });
                Object.assign(S, await api('/api/state'));
                S.audit = await api('/api/audit').catch(() => []);
                S.backup = await api('/api/backups').catch(() => null);
                renderSide();
                renderChat();
                renderInbox();
                renderPending();
                renderClients();
                renderTasks();
                renderErrands();
                toast(tx("app.copy.sample_data_loaded.73a205b"));
                go('hoy');
            }
            catch (err) {
                if (!force && /Ya tienes datos/.test(err.message)) {
                    demo.dataset.confirm = '1';
                    bindValue(demo, "textContent", () => tx("app.extra.d0652ad30"));
                    bindValue($('#demo-note'), "textContent", () => err.message);
                }
                else
                    toast(err.message, true);
            }
            finally {
                demo.disabled = false;
            }
            return;
        }
        if (e.target.closest('#shutdown-app')) {
            if (!confirm(tx("app.copy.quit_rem_your_data_will.5af926c")))
                return;
            await api('/api/shutdown', { method: 'POST' });
            bindValue(document.body, "innerHTML", () => tx("app.extra.9e4d11ce9"));
            return;
        }
        const m = e.target.closest('[data-models]');
        if (m) {
            await saveSection(f);
            m.disabled = true;
            out(tx("app.copy.cargando.205443e"), true);
            loadedModels[m.dataset.models] = await api(`/api/models/${m.dataset.models}`);
            if (m.dataset.models === 'local')
                loadedLocalUrl = S.settings.local.url;
            renderSettings();
            toast(loadedModels[m.dataset.models].length ? tx("app.copy.modelos_disponibles.006d2a9", loadedModels[m.dataset.models].length) : tx("app.copy.no_models_found_download_one.e5bfd3c"), !loadedModels[m.dataset.models].length);
            return;
        }
        const t = e.target.closest('[data-test]');
        if (t) {
            await saveSection(f);
            t.disabled = true;
            out(tx("app.copy.probando.a3da3a4"), true);
            const r = await api(`/api/test/${t.dataset.test}`, { method: 'POST' });
            out(tx("app.copy.funciona_s.4b07d59", formatNumber(r.ms / 1000,{minimumFractionDigits:1,maximumFractionDigits:1}), r.sample ? `: ${r.sample}` : ''), true);
            t.disabled = false;
            return;
        }
        const k = e.target.closest('[data-key]');
        if (k) {
            const value = f.key.value.trim();
            if (!value) {
                out(tx("app.copy.paste_the_key_first.221963f"), false);
                return;
            }
            S.settings = await api('/api/secrets', { method: 'POST', body: { name: k.dataset.key, value } });
            toast(tx("app.copy.key_saved.a45a97c"));
            renderSettings();
            return;
        }
        if (e.target.closest('#add-agent')) {
            readAgents();
            const p = S.presets.agents[Number($('#agent-preset').value)];
            draftAgents.push({ id: `${p.name.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`, name: p.name, kind: p.kind, app: p.app, url: '', handle: '', openUrl: '', notes: p.notes });
            renderSettings();
            return;
        }
        const del = e.target.closest('[data-agent-del]');
        if (del) {
            readAgents();
            draftAgents.splice(Number(del.dataset.agentDel), 1);
            renderSettings();
            return;
        }
        if (e.target.closest('#save-agents')) {
            readAgents();
            S.settings = await api('/api/settings', { method: 'POST', body: { agents: draftAgents } });
            draftAgents = null;
            toast(tx("app.copy.saved_agents.ca27b9c"));
            renderSettings();
            renderErrands();
            return;
        }
        const sk = e.target.closest('[data-agent-savekey]');
        if (sk) {
            readAgents();
            S.settings = await api('/api/settings', { method: 'POST', body: { agents: draftAgents } });
            const box = sk.closest('[data-agent]');
            const a = draftAgents[Number(sk.dataset.agentSavekey)];
            S.settings = await api('/api/secrets', { method: 'POST', body: { name: `agent:${a.id}`, value: $('[data-agent-key]', box).value } });
            draftAgents = null;
            toast(tx("app.copy.key_saved.a45a97c"));
            renderSettings();
            return;
        }
        const at = e.target.closest('[data-agent-test]');
        if (at) {
            readAgents();
            S.settings = await api('/api/settings', { method: 'POST', body: { agents: draftAgents } });
            const a = draftAgents[Number(at.dataset.agentTest)];
            const r = await api(`/api/test/agent/${encodeURIComponent(a.id)}`, { method: 'POST' });
            out(r.note || tx("app.copy.funciona.5f824db"), true);
            return;
        }
    }
    catch (err) {
        out(err.message, false);
        $$('[data-test],[data-models]', settingsBox).forEach((b) => (b.disabled = false));
    }
});
/* ---------------- Arranque ---------------- */
const languagePreference=createLanguagePreference({readSettings:()=>S.settings,writeSettings:value=>{S.settings=value;},save:body=>api('/api/settings',{method:'POST',body})});
$('#language-form').addEventListener('submit',event=>event.preventDefault());
$('#language').addEventListener('change',async event=>{const selected=event.target;selected.disabled=true;bindValue($('#language-status'),'textContent',()=>tx('language.saving'));try{await languagePreference.choose(selected.value);bindValue($('#language-status'),'textContent',()=>tx('language.saved'));}catch(e){selected.value=getLanguage();bindValue($('#language-status'),'textContent',()=>tx('language.error',e.code||'I18N_SAVE_UNCONFIRMED'));}finally{selected.disabled=false;}});
onLanguageChange(()=>{if(S){$('#language').value=getLanguage();refreshModelWarning();}});
const moduleLibrary = mountModuleLibrary({ api, onOpen: item => { go(MODULE_KINDS[item.manifest.kind].route); activeRemModule = { id: item.manifest.id, kind: item.manifest.kind }; document.dispatchEvent(new CustomEvent('rem-module-open', { detail: { kind: item.manifest.kind, id: item.manifest.id, title: displayText(item.installation?.config.title ?? item.manifest.name), subtitle: displayText(item.installation?.config.subtitle ?? item.manifest.description) } })); } });
const copiesUI = mountCopies({ api }), requestedView = location.hash.slice(1);
(async () => {
    await loadAroundMaintenance(load, async () => { document.getElementById('awos-form').hidden = true; go('awos'); await copiesUI?.refresh(); });
    document.getElementById('awos-form').hidden = false;
    await mountAwos({ api });
    await mountIntakes({ api })?.refresh().catch(() => { });
    await copiesUI?.refresh();
    go(requestedView || aiReadyOrSettings());
    document.getElementById('main').setAttribute('aria-busy', 'false');
})().catch(e => {
    copiesUI?.stop();
    bindValue(document.body, "innerHTML", () => tx("app.copy.cannot_connect_to_rem_close.6914d66", esc(e.message)));
});
function aiReadyOrSettings() { return aiReady() ? 'hoy' : 'ajustes'; }
document.addEventListener('keydown', (e) => {
    if (!S)
        return;
    if (!(e.metaKey || e.ctrlKey))
        return;
    const order = ['hoy', 'asistente', 'clasificar', 'aprobaciones', 'clientes', 'tareas', 'encargos', 'registro'];
    const n = Number(e.key);
    if (n >= 1 && n <= order.length) {
        e.preventDefault();
        go(order[n - 1]);
    }
    if (e.key === ',') {
        e.preventDefault();
        go('ajustes');
    }
});
// Navigation only: opening a prepared contact never submits a proposal or decision.
document.addEventListener('click', e => {
    const b = e.target.closest('[data-intake-review]');
    if (!b || !S?.awosIntakesEnabled)
        return;
    go('clasificar');
    document.dispatchEvent(new CustomEvent('awos-intake-select', { detail: { messageId: Number(b.dataset.intakeReview) } }));
});
document.addEventListener('rem-module-exit', () => { activeRemModule = null; });
document.addEventListener('rem-module-open', e => {
    if (e.detail.kind === 'requests')
        document.querySelector('[data-intake-paste] textarea')?.focus();
});
document.addEventListener('awos-intake-propose', () => {
    activeRemModule = null;
    if (S?.awosIntakesEnabled)
        go('awos');
});
document.addEventListener('awos-intakes-changed', () => load().catch(e => toast(e.message, true)));
