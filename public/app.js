import {displayText} from './display-text.js';
import {mountModuleLibrary} from './module-library.js';
import {MODULE_KINDS,scopedModulePath} from './module-contract.js';
'use strict';
import { warningsHtml, dateWarningsHtml } from './proposal-warnings.js';
import { smallModelWarning } from './model-capacity.js';
import {mountIntakes} from './intake-panel.js';
import { mountAwos } from './awos-panel.js';
import {mountCopies,loadAroundMaintenance} from './awos-copies.js';
// Interfaz de REM. Sin dependencias: habla con la API local del propio Mac.
const TOKEN = document.querySelector('meta[name="pyme1-token"]').content;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id) => `<svg class="i" aria-hidden="true"><use href="#${id}"/></svg>`;
const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
const fmtDay = (ymd) => ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' });
const dayKey = (iso) => new Date(iso).toLocaleDateString('sv-SE');
const isToday = (iso) => !!iso && dayKey(iso) === new Date().toLocaleDateString('sv-SE');
function relDay(iso) {
  const k = dayKey(iso), d = new Date(); const today = d.toLocaleDateString('sv-SE');
  d.setDate(d.getDate() - 1); const yest = d.toLocaleDateString('sv-SE');
  if (k === today) return 'today'; if (k === yest) return 'yesterday';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;
const initials = (name) => { const w = String(name || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter((x) => x.length > 1 && !/^(de|del|y)$/i.test(x)); return (w.length ? (w[0][0] + (w[1]?.[0] || '')) : '·').toUpperCase(); };

let S = null;
let justStamped = null;
let loadedModels = { local: [], external: [] };
let draftAgents = null;
let loadedLocalUrl = null;
let capacityRequest = null;

let activeRemModule=null;
async function api(path, { method = 'GET', body } = {}) {
  if(activeRemModule&&method==='POST')path=scopedModulePath(path,activeRemModule.id);
  const r = await fetch(path, { method, headers: { 'x-pyme1-token': TOKEN, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(displayText(data.message) || 'Something went wrong.'); e.code = data.error; throw e; }
  return data;
}
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.classList.toggle('bad', bad); t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), bad ? 5000 : 2800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { toast('Could not copy. Select the text and copy it manually.', true); }
}

/* ---------------- Navigation ---------------- */
const TITLES = { modulos:'Modules', hoy: 'Today', asistente: 'Assistant', clasificar: 'Message triage', aprobaciones: 'Review', clientes: 'Clients', tareas: 'Tasks', encargos: 'Errands', registro: 'Activity and privacy', ajustes: 'Settings', awos: 'Experimental email' };
const moreSheet = document.querySelector('#more-sheet');
const moreOpen = document.querySelector('#more-open');
new ResizeObserver(([entry]) => { const height = Math.ceil(entry.target.getBoundingClientRect().height); if (height) document.documentElement.style.setProperty('--mobile-nav-height', `${height}px`); }).observe(document.querySelector('.mobile-tabs'));
moreOpen.addEventListener('click', () => { moreSheet.showModal(); moreOpen.setAttribute('aria-expanded', 'true'); });
moreSheet.addEventListener('close', () => { moreOpen.setAttribute('aria-expanded', 'false'); moreOpen.focus(); });
function go(view) {
  if(activeRemModule&&view!==MODULE_KINDS[activeRemModule.kind].route)activeRemModule=null;
  if (moreSheet.open) moreSheet.close();
  if (['modulos','tareas','clasificar','encargos','registro','ajustes'].includes(view)) moreOpen.setAttribute('aria-current','page');
  else moreOpen.removeAttribute('aria-current');
  if (!TITLES[view]) view = 'hoy';
  $$('.view').forEach((v) => v.classList.toggle('on', v.id === `v-${view}`));
  $$('[data-view]').forEach((a) => (a.dataset.view === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#title').textContent = TITLES[view];
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (view === 'modulos') void moduleLibrary?.refresh();
  if (view === 'registro') renderAudit();
  if (view === 'hoy') renderToday();
  if (view === 'ajustes') { draftAgents = null; renderSettings(); }
  if (view === 'asistente') { scrollChat(); $('#msg').focus(); }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-view]'); if (!a) return;
  if(!S){e.preventDefault();return;}
  e.preventDefault(); go(a.dataset.view);
});
window.addEventListener('hashchange', () => {if(S)go(location.hash.slice(1));});

async function load() {
  S = await api('/api/state');
  try { S.audit = await api('/api/audit'); } catch { S.audit = []; }
  try { S.backup = await api('/api/backups'); } catch { S.backup = null; }
  renderSide(); renderToday(); renderChat(); renderInbox(); renderPending(); renderClients(); renderTasks(); renderErrands();
}

/* ---------------- Barra lateral ---------------- */
function aiReady() { const s = S.settings; return (s.local.enabled && s.local.model) || (s.external.enabled && s.external.model && s.privacy !== 'local-only'); }
function renderSide() {
  const s = S.settings;
  $('#biz').textContent = s.profile.business || s.profile.name || 'Your AI workspace';
  $('#c-pend').textContent = S.pending.length || '';
  $('#c-tasks').textContent = S.tasks.filter((t) => !t.done).length || '';
  $('#c-today').textContent = S.inbox.filter((m) => isToday(m.created_at)).length || '';
  const b = S.backup?.last;
  $('#st-backup').innerHTML = `${icon('i-backup')}<span>${b ? `${S.backup?.scope === 'pyme1-only' ? 'REM copy' : 'Backup'}: ${esc(relDay(b.at))}, ${esc(hhmm(b.at))}` : 'No backup yet'}</span>`;
  const line = (on, text, title) => `<i class="dot ${on ? 'on' : ''}"></i><span title="${esc(title)}">${esc(text)}</span>`;
  $('#st-local').innerHTML = line(s.local.enabled && s.local.model, s.local.enabled && s.local.model ? `Local: ${s.local.model}` : 'Local AI not configured', 'Local AI (Ollama)');
  const ext = s.external.enabled && s.external.model && s.privacy !== 'local-only';
  $('#st-ext').innerHTML = line(ext, ext ? `External: ${s.external.label || s.external.model}` : 'External AI disabled', 'External AI');
  const dec = s.decision.kind !== 'none' && s.privacy !== 'local-only';
  $('#st-dec').innerHTML = line(dec, dec ? `Decision: ${s.decision.model || S.presets.decision[s.decision.kind].model}` : 'General AI classification', 'Decision model');
}

/* ---------------- Proposals (tarjetas aprobables) ---------------- */
const KINDS = {
  crear_tarea: { title: () => 'New task', btn: 'Create task', fields: [['titulo', 'Task'], ['fecha', 'Date', 'date'], ['cliente', 'Client']] },
  crear_cliente: { title: () => 'New client', btn: 'Create client', fields: [['nombre', 'Name'], ['email', 'Email'], ['telefono', 'Phone'], ['notas', 'Notes', 'area']] },
  anadir_nota: { title: (p) => `Note for ${p.cliente}`, btn: 'Add note', fields: [['cliente', 'Client'], ['texto', 'Note', 'area']] },
  redactar_mensaje: { title: (p) => `Message${p.cliente ? ` for ${p.cliente}` : ''}`, btn: 'Save draft', fields: [['cliente', 'To'], ['canal', 'Channel', 'select', [['correo', 'Email'], ['whatsapp', 'WhatsApp'], ['otro', 'Other']]], ['asunto', 'Subject'], ['texto', 'Message', 'area']] },
  encargar: { title: (p) => `Errand for ${p.agente_nombre}`, btn: 'Approve errand', fields: [['encargo', 'Errand', 'area']],
    warn: (p) => `Approval will send this text from your Mac to ${p.agente_nombre}. Check that it contains only the necessary information.` },
};
const SOURCES = { asistente: 'Proposed by your assistant', clasificador: 'Prepared during triage', 'tú': 'Prepared by you' };

function field(p, [name, label, type, opts], locked) {
  const v = p.payload[name] ?? '';
  const dis = locked ? 'disabled' : '';
  let input;
  if (type === 'area') input = `<textarea name="${name}" rows="${name === 'texto' || name === 'encargo' ? 6 : 3}" ${dis}>${esc(v)}</textarea>`;
  else if (type === 'select') input = `<select name="${name}" ${dis}>${opts.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${val}" ${val === v ? 'selected' : ''}>${lab}</option>`; }).join('')}</select>`;
  else input = `<input name="${name}" type="${type || 'text'}" value="${esc(v)}" ${dis}>`;
  const hide = name === 'asunto' && p.payload.canal !== 'correo' && !v ? ' hidden' : '';
  return `<label data-f="${name}"${hide}>${label}${input}</label>`;
}

function resultHtml(p) {
  const r = p.result || {};
  const links = [...(r.links || []), ...(r.handoff?.links || [])];
  const text = r.text || r.handoff?.text;
  const resultLabel = p.kind === 'redactar_mensaje' ? 'Draft saved' : displayText(r.message) || 'Approved';
  return `<span class="res">${icon('i-check')}${esc(resultLabel)}</span>
    ${links.map((l) => `<a class="btn small" href="${esc(l.href)}" target="_blank" rel="noopener">${icon('i-out')}${esc(displayText(l.label))}</a>`).join('')}
    ${text ? `<button class="btn small" data-copy="${p.id}">${icon('i-copy')}Copy text</button>` : ''}`;
}

function propCard(p, { animate = false } = {}) {
  const k = KINDS[p.kind]; if (!k) return '';
  animate = animate || p.id === justStamped;
  const done = p.status === 'approved', gone = p.status === 'discarded';
  const fields = k.fields;
  const grouped = p.kind === 'redactar_mensaje'
    ? `<div class="two">${field(p, fields[0], done || gone)}${field(p, fields[1], done || gone)}</div>${field(p, fields[2], done || gone)}${field(p, fields[3], done || gone)}`
    : p.kind === 'crear_tarea'
      ? `${field(p, fields[0], done || gone)}<div class="two">${field(p, fields[1], done || gone)}${field(p, fields[2], done || gone)}</div>`
      : fields.map((f) => field(p, f, done || gone)).join('');
  const foot = done ? resultHtml(p)
    : gone ? '<span class="faint" style="margin-right:auto">Dismissed</span>'
    : `<span class="err" data-err></span><button class="btn ghost" data-discard="${p.id}">Dismiss</button><button class="btn primary" data-approve="${p.id}">${icon('i-seal')}${k.btn}</button>`;
  const stamp = done ? `<span class="approval-badge">${p.kind === 'redactar_mensaje' ? 'Draft approved' : 'Proposal approved'}</span>` : '';
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
  if (e.target.name !== 'canal') return;
  const card = e.target.closest('.prop'); const f = card && $('[data-f="asunto"]', card);
  if (f) f.hidden = e.target.value !== 'correo' && !$('input', f).value;
});
document.addEventListener('click', async (e) => {
  const ap = e.target.closest('[data-approve]');
  const ds = e.target.closest('[data-discard]');
  const cp = e.target.closest('[data-copy]');
  if (cp) { const p = allProps().get(Number(cp.dataset.copy)); if (p) copy(p.result?.text || p.result?.handoff?.text || ''); return; }
  if (!ap && !ds) return;
  const btn = ap || ds;
  const card = btn.closest('.prop');
  const id = Number(btn.dataset.approve || btn.dataset.discard);
  const payload = Object.fromEntries($$('[name]', card).map((el) => [el.name, el.value]));
  btn.disabled = true;
  if (ap) btn.innerHTML = '<i class="spin"></i>Aprobando…';
  try {
    const p = await api(`/api/proposals/${id}/${ap ? 'approve' : 'discard'}`, { method: 'POST', body: ap ? { payload } : {} });
    S.chatProposals = { ...(S.chatProposals || {}), [p.id]: p };
    if (ap) { justStamped = p.id; setTimeout(() => { justStamped = null; }, 1500); }
    $$(`.prop[data-prop="${id}"]`).forEach((c) => { c.outerHTML = propCard(p, { animate: true }); });
    toast(ap ? (p.kind === 'redactar_mensaje' ? 'Draft saved' : p.result?.message || 'Approved') : 'Dismissed');
    const fresh = await api('/api/state');
    Object.assign(S, fresh, { chatProposals: { ...fresh.chatProposals, ...S.chatProposals } });
    renderSide(); renderPending(); renderClients(); renderTasks(); renderErrands(); renderInbox(); renderToday();
  } catch (err) {
    btn.disabled = false; if (ap) btn.innerHTML = `${icon('i-seal')}${KINDS[card ? allProps().get(id)?.kind : '']?.btn || 'Approve'}`;
    const slot = $('[data-err]', card); if (slot) slot.textContent = err.message; else toast(err.message, true);
  }
});

/* ---------------- Assistant ---------------- */
const SUGGESTIONS = [
  '¿Qué tengo pendiente esta semana?',
  'Crea un cliente: Marta Ruiz, marta@correo.es',
  'Recuérdame llamar a Marta el lunes',
  'Redacta un recordatorio amable de pago para Marta',
];
function viaText(v) {
  if (!v) return '';
  const base = v.target === 'local' ? `Local AI, ${v.model}` : `${v.label}, ${v.model}${v.anonymized ? ', with partial anonymization' : ''}`;
  return `${icon(v.target === 'local' ? 'i-chip' : 'i-cloud')}<span>${esc(base)}${v.fallback ? '. Local AI did not respond.' : ''}</span>`;
}
function renderChat() {
  const box = $('#chat');
  if (!S.chat.length) {
    const p = S.settings.profile;
    box.innerHTML = `<div class="welcome">
      <h2>${p.name ? `Hello, ${esc(p.name.split(' ')[0])}.` : 'Hello.'}</h2>
      <p>I can help organize clients and tasks, draft messages, and prepare errands for other agents. Proposals need your approval. Assistant language examples are currently Spanish.</p>
      ${aiReady() ? `<p class="help">Spanish assistant examples:</p><div class="chips">${SUGGESTIONS.map((s) => `<button class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
        : `<div class="setup">Connect local AI (Ollama), external AI, or both to start. <a href="#ajustes" data-view="ajustes">Go to Settings</a></div>`}
    </div>`;
    return;
  }
  box.innerHTML = S.chat.map((m) => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.content)}</div>`;
    const props = (m.meta?.proposals || []).map((id) => (S.chatProposals || {})[id]).filter(Boolean);
    return `<div class="msg assistant">${esc(m.content)}${props.map((p) => propCard(p)).join('')}<div class="via">${viaText(m.meta?.via)}</div></div>`;
  }).join('');
  scrollChat();
}
function scrollChat() { const s = $('#chat-scroll'); s.scrollTop = s.scrollHeight; }
const msg = $('#msg');
const fit = () => { msg.style.height = 'auto'; msg.style.height = Math.min(200, msg.scrollHeight + 2) + 'px'; };
msg.addEventListener('input', fit);
msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
document.addEventListener('click', (e) => { const s = e.target.closest('[data-suggest]'); if (s) { msg.value = s.dataset.suggest; fit(); msg.focus(); } });
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = msg.value.trim(); if (!text) return;
  msg.value = ''; fit();
  if (!S.chat.length) $('#chat').innerHTML = '';
  $('#chat').insertAdjacentHTML('beforeend', `<div class="msg user">${esc(text)}</div><div class="thinking" id="thinking"><i class="spin"></i>Thinking…</div>`);
  scrollChat();
  $('#send').disabled = true;
  try {
    const r = await api('/api/chat', { method: 'POST', body: { text, prefer: $('#prefer').value || undefined } });
    S.chat.push({ role: 'user', content: text }, r.message);
    S.chatProposals = { ...(S.chatProposals || {}), ...Object.fromEntries(r.proposals.map((p) => [p.id, p])) };
    S.pending = [...r.proposals, ...S.pending];
    renderChat(); renderSide(); renderPending(); renderToday();
  } catch (err) {
    $('#thinking')?.remove();
    $('#chat').insertAdjacentHTML('beforeend', `<div class="msg assistant"><span style="color:var(--bad)">${esc(err.message)}</span>${err.code === 'NOT_CONFIGURED' || err.code === 'UNREACHABLE' ? ' <a href="#ajustes" data-view="ajustes">Revisar Settings</a>' : ''}</div>`);
    S.chat.push({ role: 'user', content: text });
    msg.value = text; fit();
  } finally { $('#send').disabled = false; scrollChat(); }
});
$('#clear-chat').addEventListener('click', async () => { await api('/api/chat/clear', { method: 'POST' }); S.chat = []; renderChat(); });

/* ---------------- Clasificar ---------------- */
const CAT = { presupuesto: 'Quote', cita: 'Appointment', incidencia: 'Issue', administrativo: 'Administration', informativo: 'Information', otro: 'Other' };
const CAT_TONE = { presupuesto: 'sello', cita: 'ok', incidencia: 'bad' };
const URG = ['Can wait', 'One or two days', 'Today'];
function decisionVia(v) {
  if (!v) return '';
  if (v.emulated) return `Classified by ${v.target === 'local' ? 'your local AI' : v.label} (estimated)${v.fallbackReason ? `. The decision model did not respond: ${v.fallbackReason}` : ''}`;
  return `Classified with ${v.label}, model ${v.model}${v.anonymized ? ', with partial anonymization' : ''}`;
}
function triageHtml(r) {
  const a = r.answers;
  const top = Object.entries(a.categoria.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3);
  return `<div class="card">
    <div class="readouts">
      <div class="readout"><div class="k">Type</div><div class="v">${esc(CAT[a.categoria.choice] || a.categoria.choice)}</div>
        <div class="bars">${top.map(([k, v]) => `<div class="bar"><span>${esc(CAT[k] || k)}</span><i><b style="width:${Math.round(v * 100)}%"></b></i><span>${Math.round(v * 100)} %</span></div>`).join('')}</div></div>
      <div class="readout"><div class="k">Urgency</div><div class="v">${esc(URG[a.urgencia.level] || a.urgencia.label)}</div>
        <div class="levels" aria-label="Nivel ${a.urgencia.level + 1} de 3">${[0, 1, 2].map((i) => `<i class="${i <= a.urgencia.level ? 'on' : ''}"></i>`).join('')}</div></div>
      <div class="readout"><div class="k">Reply needed</div><div class="v">${Math.round(a.responder.noul * 100)} %</div>
        <div class="bars"><div class="bar" style="grid-template-columns:1fr"><i><b style="width:${Math.round(a.responder.noul * 100)}%"></b></i></div></div></div>
    </div>
    ${r.summary ? `<p class="summary">${esc(r.summary)}</p>` : ''}
    <div class="via">${icon(r.via?.target === 'local' ? 'i-chip' : 'i-bolt')}<span>${esc(decisionVia(r.via))}${r.client ? `. Client: ${esc(r.client.name)}` : ''}</span></div>
  </div>
  ${r.proposals.map((p) => propCard(p)).join('') || '<p class="muted" style="margin-top:14px">No reply needed.</p>'}`;
}
$('#triage-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#t-text').value.trim();
  if (!text) { toast('Paste a message first.', true); return; }
  const b = $('#t-go'); b.disabled = true; b.innerHTML = '<i class="spin"></i>Clasificando…';
  $('#triage-result').innerHTML = '';
  try {
    const r = await api('/api/triage', { method: 'POST', body: { text, channel: $('#t-channel').value, sender: $('#t-sender').value } });
    S.chatProposals = { ...(S.chatProposals || {}), ...Object.fromEntries(r.proposals.map((p) => [p.id, p])) };
    $('#triage-result').innerHTML = triageHtml(r);
    $('#t-text').value = '';
    const fresh = await api('/api/state'); Object.assign(S, fresh, { chatProposals: { ...fresh.chatProposals, ...S.chatProposals } });
    renderSide(); renderPending(); renderInbox(); renderToday();
  } catch (err) {
    $('#triage-result').innerHTML = `<div class="card" style="color:var(--bad)">${esc(err.message)} ${err.code === 'NOT_CONFIGURED' ? '<a href="#ajustes" data-view="ajustes">Revisar Settings</a>' : ''}</div>`;
  } finally { b.disabled = false; b.textContent = 'Classify and draft reply'; }
});
function inboxRow(m) {
  const a = m.analysis?.answers;
  const client = S.clients.find((c) => c.id === m.client_id);
  const who = client?.name || m.sender || 'No sender';
  const props = (m.analysis?.proposals || []).map((id) => allProps().get(id)).filter(Boolean);
  const cat = a?.categoria?.choice;
  const lvl = a ? a.urgencia.level : -1;
  const quiet = a && (cat === 'otro' || cat === 'informativo') && !props.length;
  const msgP = props.find((p) => p.kind === 'redactar_mensaje'), taskP = props.find((p) => p.kind === 'crear_tarea');
  const state = msgP ? (msgP.status === 'approved' ? [icon('i-check'), 'Draft saved', 'ok'] : msgP.status === 'discarded' ? ['', 'Reply descartada', ''] : [icon('i-seal'), 'Draft prepared', 'ready'])
    : taskP ? [icon('i-list'), taskP.status === 'approved' ? 'Task created' : 'Proposed task', '']
    : cat === 'otro' ? [icon('i-archive'), 'Archivado', ''] : a ? ['', 'No necesita respuesta', ''] : ['', '', ''];
  const ch = m.channel === 'whatsapp' ? 'i-wa' : m.channel === 'correo' ? 'i-mail' : 'i-chat';
  return `<div class="mrow${quiet ? ' dim' : ''}${lvl === 2 ? ' hot' : ''}">
    <div class="av">${esc(initials(who))}<span class="ch ${esc(m.channel)}">${icon(ch)}</span></div>
    <div class="mmid"><div class="mtop"><b>${esc(who)}</b><time>${esc(isToday(m.created_at) ? hhmm(m.created_at) : fmtDate(m.created_at))}</time></div>
      <div class="msum">${esc(m.analysis?.summary || m.text)}</div>
      ${a ? `<div class="mtags"><span class="pill ${CAT_TONE[cat] || ''}">${esc(CAT[cat] || cat)}</span>${lvl > 0 ? `<span class="pill ghost">Urgency <span class="urg l${lvl + 1}" aria-label="${esc(URG[lvl])}"><i></i><i></i><i></i></span></span>` : ''}</div>` : ''}</div>
    <div class="mright"><span class="state ${state[2]}">${state[0]}${esc(state[1])}</span>${S.awosIntakesEnabled?`<button type="button" class="btn secondary" data-intake-review="${m.id}">Review AWOS contact</button>`:''}</div>
  </div>`;
}
function renderInbox() {
  $('#inbox-list').innerHTML = S.inbox.length ? S.inbox.map(inboxRow).join('')
    : '<div class="empty pad"><strong>No classified messages yet</strong>Messages you paste above will appear here.</div>';
}

/* ---------------- Today ---------------- */
const EXTERNAL = ['ia_externa', 'decision_externa', 'encargo_externo'];
function renderToday() {
  if (!S) return;
  const p = S.settings.profile, h = new Date().getHours();
  const hello = h < 14 ? 'Good morning' : h < 21 ? 'Good afternoon' : 'Good evening';
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
  $('#today-date').textContent = todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1);
  $('#hello').textContent = p.name ? `${hello}, ${p.name.split(' ')[0]}` : hello;
  const todays = S.inbox.filter((m) => isToday(m.created_at));
  const replies = S.pending.filter((x) => x.kind === 'redactar_mensaje').length;
  const tasksP = S.pending.filter((x) => x.kind === 'crear_tarea').length;
  const n = (k, one, many) => `<b>${k} ${k === 1 ? one : many}</b>`;
  $('#today-sum').innerHTML = todays.length || S.pending.length
    ? `${todays.length ? `Today received ${n(todays.length, 'message', 'messages')} for classification. ` : ''}${S.pending.length ? `Awaiting review: ${n(replies, 'reply', 'replies')} ${tasksP ? `and ${n(tasksP, 'task', 'tasks')} ` : ''}to review.` : 'Nothing is awaiting approval.'} You decide what happens to each proposal.`
    : 'All caught up. Paste a client message or ask your assistant for help.';
  const out = (S.audit || []).filter((r) => EXTERNAL.includes(r.kind) && isToday(r.at)).length;
  $('#privacy').className = `privacy${out ? ' warn' : ''}`;
  $('#privacy').innerHTML = `${icon(out ? 'i-cloud' : 'i-shield')}<div><strong>${out ? `${out} external ${out === 1 ? 'request' : 'requests'} recorded today` : 'Processed on this Mac'}</strong><span>${out ? 'Check the activity log for details.' : 'No client data has left today.'}</span></div>`;
  const recent = S.inbox.slice(0, 7);
  $('#today-inbox').innerHTML = recent.length ? recent.map(inboxRow).join('')
    : '<div class="empty pad"><strong>No messages yet</strong>Paste an email or WhatsApp message in Message triage to see it here, sorted by urgency.</div>';
  const stamped = S.recent.filter((x) => x.status === 'approved' && isToday(x.decided_at)).slice(0, 1);
  const cards = S.pending.slice(0, 4);
  const waiting = S.tasks.filter(t => !t.done);
  $('#today-overview').innerHTML = [
    ['i-seal', S.pending.length, 'Need your review', `${replies} message ${replies === 1 ? 'draft' : 'drafts'}`, 'aprobaciones'],
    ['i-tray', todays.length, 'Today’s messages', 'Review client messages', 'clasificar'],
    ['i-cal', waiting.length, 'Pending tasks', `${waiting.filter(t => t.due && t.due <= new Date().toLocaleDateString('sv-SE')).length} due today or earlier`, 'tareas'],
    ['i-people', S.clients.length, 'Clients in your workspace', 'Contacts and notes on this Mac', 'clientes'],
  ].map(([symbol,total,label,detail,view]) => `<a class="metric-card" href="#${view}" data-view="${view}"><div class="metric-top"><span class="metric-icon">${icon(symbol)}</span><span>${esc(label)}</span></div><strong>${total}</strong><small>${esc(detail)}</small></a>`).join('');
  $('#today-review').textContent = S.pending.length ? `Review ${S.pending.length} ${S.pending.length === 1 ? 'proposal' : 'proposals'}` : 'Request a draft';
  $('#today-review').dataset.view = S.pending.length ? 'aprobaciones' : 'asistente';
  $('#today-review').href = S.pending.length ? '#aprobaciones' : '#asistente';
  const dueFollowups=S.awosFollowups??[];
  const upcoming = [...waiting].sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0,Math.max(0,4-dueFollowups.length));
  $('#today-next').innerHTML = upcoming.length ? upcoming.map(t => `<li><div><strong>${esc(t.title)}</strong>${t.client_name ? `<span>${esc(t.client_name)}</span>` : ''}</div><time>${esc(t.due ? new Date(t.due + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'short',day:'numeric',month:'short'}) : 'No date')}</time></li>`).join('') : '<li><div><strong>No pending tasks</strong><span>Your task list is up to date.</span></div></li>';
  if(dueFollowups.length)$('#today-next').innerHTML=dueFollowups.map(f=>`<li><div><strong>Pending follow-up</strong><span>${esc(f.note||'Proposal approved')}</span></div><a class="btn small" href="#awos" data-view="awos">Open</a></li>`).join('')+$('#today-next').innerHTML;
  $('#today-approved-section').hidden = !stamped.length;
  $('#today-approved').innerHTML = stamped.map(p => `<details class="review-detail"><summary><span>${esc(KINDS[p.kind]?.title(p.payload) || 'Proposal')}</span><span class="pill ok">${p.kind === 'redactar_mensaje' ? 'Draft approved' : 'Approved'}</span></summary>${propCard(p)}</details>`).join('');
  $('#today-pend').textContent = S.pending.length ? `${S.pending.length} pending` : 'All caught up';
  $('#today-props').innerHTML = cards.length ? cards.map((x) => {
    const target = x.payload.cliente || x.payload.nombre || '';
    const contact = S.clients.find(c => c.name === target);
    const title = x.kind === 'redactar_mensaje' ? target || 'Recipient needs review' : x.payload.titulo || KINDS[x.kind]?.title(x.payload) || 'Proposal';
    const channel = x.kind === 'redactar_mensaje' ? (x.payload.canal === 'correo' ? 'Email' : x.payload.canal === 'whatsapp' ? 'WhatsApp' : 'Other channel') : 'Proposed task';
    const preview = x.payload.texto || x.payload.notas || (x.kind === 'crear_tarea' ? `Awaiting creation${target ? ` · ${target}` : ''}` : 'Open the proposal to review its full details.');
    return `<details class="review-detail work-card"><summary>
      <div class="review-person"><span class="av" aria-hidden="true">${esc(initials(target || title))}</span><span><strong>${esc(title)}</strong><small>${esc(contact?.email || target || channel)}</small></span><span class="pill">${esc(channel)}</span></div>
      ${x.payload.asunto ? `<span class="review-subject">${esc(x.payload.asunto)}</span>` : ''}
      <span class="review-preview">${esc(preview.slice(0,200))}${preview.length > 200 ? '…' : ''}</span>
      <span class="review-bottom">${x.payload.avisos?.length ? '<span class="pill warn">Review numbers before approving</span>' : '<span class="review-source">Awaiting your review</span>'}<span class="review-open">Open proposal <span aria-hidden="true">↗</span></span></span>
    </summary>${propCard(x)}</details>`;
  }).join('') : '<div class="empty-state"><h3>No pending proposals</h3><p>Ask your assistant for a draft to review here.</p><a class="btn" href="#asistente" data-view="asistente">Request a draft</a></div>';
}

/* ---------------- Aprobaciones ---------------- */
function renderPending() {
  $('#pending').innerHTML = S.pending.length ? S.pending.map((p) => propCard(p)).join('')
    : '<div class="empty-state"><div><h3>All caught up</h3><p>Proposals from your assistant will appear here.</p></div></div>';
  $('#recent').innerHTML = S.recent.map((p) => `<li><div><div class="t">${esc(KINDS[p.kind]?.title(p.payload) || p.kind)}</div><div class="m">${esc(fmtDate(p.decided_at))}</div></div>
    <div class="r"><span class="pill ${p.status === 'approved' ? 'ok' : ''}">${p.status === 'approved' ? 'Approved' : 'Dismissed'}</span></div></li>`).join('')
    || '<li class="empty-state"><div><h3>No decisions yet</h3><p>Approved and dismissed proposals will appear here.</p></div></li>';
}

/* ---------------- Clients ---------------- */
function renderClients() {
  const qy = ($('#c-search')?.value || '').trim().toLowerCase();
  const list = S.clients.filter((c) => !qy || [c.name, c.email, c.phone, c.notes].join(' ').toLowerCase().includes(qy)).sort((a,b) => a.name.localeCompare(b.name, 'es', { sensitivity:'base' }));
  $('#clients-count').textContent = qy ? `${list.length} de ${S.clients.length}` : String(S.clients.length);
  const openTasks = (id) => S.tasks.filter((t) => !t.done && t.client_id === id);
  $('#clients').innerHTML = list.length ? list.map((c) => {
    const tk = openTasks(c.id), next = tk.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
    return `<tr data-client="${c.id}">
    <td><div class="who"><span class="av">${esc(initials(c.name))}</span><div><b>${esc(c.name)}</b><small>${tk.length ? `${tk.length} ${tk.length === 1 ? 'task' : 'tasks'}${next ? `, next ${esc(fmtDay(next.due))}` : ''}` : 'No pending tasks'}</small></div></div></td>
    <td class="contact">${c.email ? `<span>${esc(c.email)}</span>` : ''}${c.phone ? `<span class="faint">${esc(c.phone)}</span>` : ''}${!c.email && !c.phone ? '<span class="faint">No contact details</span>' : ''}</td>
    <td class="note">${c.notes ? esc(c.notes.slice(0, 160)) : '<span class="faint">No notes</span>'}
      <div class="notes-edit" hidden><textarea rows="4">${esc(c.notes)}</textarea>
        <div class="actions"><button class="btn small" data-cancel-notes>Cancel</button><button class="btn small primary" data-save-notes="${c.id}">Save notes</button></div></div></td>
    <td class="row-act"><button class="btn small ghost" data-edit-notes>Notes</button><button class="btn small ghost danger" data-del-client="${c.id}" aria-label="Delete client ${esc(c.name)}">${icon('i-trash')}</button></td></tr>`;
  }).join('') : `<tr><td colspan="4"><div class="empty-state"><div><h3>${qy ? 'No matching clients' : 'No clients yet'}</h3><p>${qy ? 'Try another name, email, or phone.' : 'Add one below or ask your assistant.'}</p></div></div></td></tr>`;
  $('#k-client').innerHTML = `<option value="">Ninguno</option>${S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}`;
}
$('#c-search').addEventListener('input', renderClients);
$('#client-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/clients', { method: 'POST', body: { name: $('#c-name').value, email: $('#c-email').value, phone: $('#c-phone').value } });
    e.target.reset(); S = { ...S, ...(await api('/api/state')) }; renderClients(); toast('Client added');
  } catch (err) { toast(err.message, true); }
});
document.addEventListener('click', async (e) => {
  const li = e.target.closest('[data-client]'); if (!li) return;
  if (e.target.closest('[data-edit-notes]')) { $('.notes-edit', li).hidden = false; $('textarea', li).focus(); }
  if (e.target.closest('[data-cancel-notes]')) $('.notes-edit', li).hidden = true;
  const save = e.target.closest('[data-save-notes]');
  if (save) { await api(`/api/clients/${save.dataset.saveNotes}`, { method: 'PUT', body: { notes: $('textarea', li).value } }); S = { ...S, ...(await api('/api/state')) }; renderClients(); toast('Notes saved'); }
  const del = e.target.closest('[data-del-client]');
  if (del) {
    if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.innerHTML = 'Click again to delete'; setTimeout(() => { if (del.isConnected) { del.dataset.confirm = ''; del.innerHTML = icon('i-trash'); } }, 3000); return; }
    await api(`/api/clients/${del.dataset.delClient}`, { method: 'DELETE' }); S = { ...S, ...(await api('/api/state')) }; renderClients(); renderTasks(); toast('Client deleted');
  }
});

/* ---------------- Tasks ---------------- */
function renderTasks() {
  const today = new Date().toLocaleDateString('sv-SE');
  const qy = ($('#task-search')?.value || '').trim().toLowerCase(), filter = $('#task-filter')?.value || 'open';
  const tasks = S.tasks.filter(t => (filter === 'all' || (filter === 'done') === !!t.done) && (!qy || [t.title,t.client_name].join(' ').toLowerCase().includes(qy))).sort((a,b) => Number(a.done)-Number(b.done) || (a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.title.localeCompare(b.title,'es',{sensitivity:'base'}));
  $('#tasks-count').textContent = `${tasks.length} de ${S.tasks.length}`;
  $('#tasks').innerHTML = tasks.length ? tasks.map((t) => `<li>
    <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''} style="margin-top:3px;accent-color:var(--sello)">
      <span><span class="t" style="${t.done ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${esc(t.title)}</span>${t.client_name ? `<span class="m" style="display:block">${esc(t.client_name)}</span>` : ''}</span></label>
    <div class="r">${t.due ? `<span class="pill ${!t.done && t.due < today ? 'bad' : !t.done && t.due === today ? 'warn' : ''}">${!t.done && t.due < today ? 'Vencida, ' : ''}${esc(new Date(t.due + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'short',day:'numeric',month:'short'}))}</span>` : ''}
      <button class="btn small ghost" data-del-task="${t.id}" aria-label="Delete task: ${esc(t.title)}">${icon('i-trash')}</button></div></li>`).join('')
    : `<li class="empty-state"><div><h3>${S.tasks.length ? 'No matching tasks' : 'No tasks'}</h3><p>${S.tasks.length ? 'Try another search or filter.' : 'Add a task here or ask your assistant.'}</p></div></li>`;
}
$('#task-search').addEventListener('input', renderTasks);
$('#task-filter').addEventListener('change', renderTasks);
$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/tasks', { method: 'POST', body: { title: $('#k-title').value, due: $('#k-due').value, client_id: $('#k-client').value || null } });
    e.target.reset(); S = { ...S, ...(await api('/api/state')) }; renderTasks(); renderSide();
  } catch (err) { toast(err.message, true); }
});
document.addEventListener('change', async (e) => {
  const t = e.target.closest('[data-task]'); if (!t) return;
  await api(`/api/tasks/${t.dataset.task}`, { method: 'PUT', body: { done: t.checked } });
  S = { ...S, ...(await api('/api/state')) }; renderTasks(); renderSide();
});
document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-del-task]'); if (!d) return;
  await api(`/api/tasks/${d.dataset.delTask}`, { method: 'DELETE' }); S = { ...S, ...(await api('/api/state')) }; renderTasks(); renderSide();
});

/* ---------------- Errands ---------------- */
const ERRAND_STATE = { entregar_a_mano: ['For manual delivery', 'warn'], enviado: ['Sent', 'sello'], respondido: ['Replied', 'ok'], necesita_info: ['Requests more information', 'warn'], fallido: ['Failed', 'bad'], cerrado: ['Closed', ''] };
function handoffLinks(agent, brief) {
  const enc = encodeURIComponent(brief), digits = (agent.handle || '').replace(/\D/g, ''), out = [];
  if (agent.app === 'whatsapp' && digits) out.push({ label: 'Open in WhatsApp', href: `https://wa.me/${digits}?text=${enc}` });
  if (agent.app === 'imessage' && agent.handle) out.push({ label: 'Open in Messages', href: `sms:${agent.handle}&body=${enc}` });
  if (agent.openUrl) out.push({ label: `Open ${agent.name}`, href: agent.openUrl });
  return out;
}
function renderErrands() {
  const agents = S.settings.agents;
  const qy = ($('#errand-search')?.value || '').trim().toLowerCase();
  const errands = S.errands.filter(e => !qy || [e.agent_name,e.brief,e.response,ERRAND_STATE[e.status]?.[0]].join(' ').toLowerCase().includes(qy)).sort((a,b) => Date.parse(b.created_at)-Date.parse(a.created_at));
  $('#errands-count').textContent = qy ? `${errands.length} of ${S.errands.length}` : String(S.errands.length);
  $('#e-agent').innerHTML = agents.length ? agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('') : '<option value="">Add an agent in Settings first</option>';
  $('#errand-form button').disabled = !agents.length;
  $('#errands').innerHTML = errands.length ? errands.map((e) => {
    const agent = agents.find((a) => a.id === e.agent_id);
    const [label, tone] = ERRAND_STATE[e.status] || [e.status, ''];
    const manual = agent?.kind === 'chat' && e.status === 'entregar_a_mano';
    return `<li data-errand="${e.id}"><div>
      <div class="t">${esc(e.agent_name)}</div><div class="s">${esc(e.brief.slice(0, 400))}</div><div class="m">${esc(fmtDate(e.created_at))}</div>
      ${e.response ? `<div class="card" style="margin-top:10px;padding:10px 12px"><div class="m" style="margin:0 0 4px">Reply</div><div class="s" style="margin:0">${esc(e.response)}</div>
        <div class="actions" style="margin-top:8px"><button class="btn small" data-analyze="${e.id}">${icon('i-chat')}Ask my assistant to review</button></div></div>` : ''}
      <div class="resp-edit" hidden><textarea rows="5" style="width:100%;margin-top:8px;border:1px solid var(--rule);border-radius:8px;padding:8px 10px;background:var(--paper)" placeholder="Paste the reply from ${esc(e.agent_name)}">${esc(e.response)}</textarea>
        <div class="actions"><button class="btn small" data-cancel-resp>Cancel</button><button class="btn small primary" data-save-resp="${e.id}">Save reply</button></div></div>
    </div>
    <div class="r"><span class="pill ${tone}">${esc(label)}</span>
      ${manual ? `<button class="btn small" data-copy-brief="${e.id}">${icon('i-copy')}Copy</button>${handoffLinks(agent, e.brief).map((l) => `<a class="btn small" href="${esc(l.href)}" target="_blank" rel="noopener">${icon('i-out')}${esc(displayText(l.label))}</a>`).join('')}` : ''}
      ${agent?.kind === 'a2a' && e.remote_id && ['enviado', 'necesita_info'].includes(e.status) ? `<button class="btn small" data-refresh="${e.id}">Refresh</button>` : ''}
      ${e.status !== 'cerrado' ? `<button class="btn small ghost" data-edit-resp>${e.response ? 'Edit reply' : 'Paste reply'}</button>` : ''}</div></li>`;
  }).join('') : `<li class="empty-state"><div><h3>${S.errands.length ? 'No matching errands' : 'No errands'}</h3><p>${S.errands.length ? 'Try another search.' : 'Prepare one above or ask your assistant.'}</p></div></li>`;
}
$('#errand-search').addEventListener('input', renderErrands);
$('#errand-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const p = await api('/api/errands', { method: 'POST', body: { agent: $('#e-agent').value, brief: $('#e-brief').value } });
    S.chatProposals = { ...(S.chatProposals || {}), [p.id]: p }; S.pending = [p, ...S.pending];
    $('#errand-new').innerHTML = propCard(p); $('#e-brief').value = ''; renderSide(); renderPending();
  } catch (err) { toast(err.message, true); }
});
document.addEventListener('click', async (e) => {
  const li = e.target.closest('[data-errand]'); if (!li) return;
  const id = Number(li.dataset.errand), er = S.errands.find((x) => x.id === id);
  try {
    if (e.target.closest('[data-copy-brief]')) copy(er.brief);
    if (e.target.closest('[data-edit-resp]')) { $('.resp-edit', li).hidden = false; $('textarea', li).focus(); }
    if (e.target.closest('[data-cancel-resp]')) $('.resp-edit', li).hidden = true;
    if (e.target.closest('[data-save-resp]')) { await api(`/api/errands/${id}/response`, { method: 'POST', body: { response: $('.resp-edit textarea', li).value } }); S = { ...S, ...(await api('/api/state')) }; renderErrands(); toast('Reply guardada'); }
    if (e.target.closest('[data-refresh]')) { await api(`/api/errands/${id}/refresh`, { method: 'POST' }); S = { ...S, ...(await api('/api/state')) }; renderErrands(); toast('Actualizado'); }
    if (e.target.closest('[data-analyze]')) { go('asistente'); msg.value = `${er.agent_name} ha respondido a mi encargo «${er.brief.slice(0, 120)}». Esta es su respuesta:\n\n${er.response}\n\n¿Qué me recomiendas hacer?`; fit(); msg.focus(); }
  } catch (err) { toast(err.message, true); }
});

/* ---------------- Registro ---------------- */
const AUDIT = { ia_externa: 'External AI request', decision_externa: 'External model classification', encargo_externo: 'Errand for another agent', mensaje_aprobado: 'Draft saved', clave: 'API key saved' };
async function renderAudit() {
  const rows = S.audit = await api('/api/audit');
  const outToday = rows.filter((r) => EXTERNAL.includes(r.kind) && isToday(r.at)).length;
  const week = Date.now() - 7 * 864e5;
  const outWeek = rows.filter((r) => EXTERNAL.includes(r.kind) && Date.parse(r.at) > week).length;
  const approved = S.recent.filter((p) => p.status === 'approved').length;
  $('#audit-zero').innerHTML = `<div class="big ${outToday ? 'warn' : ''}">${outToday}</div><p>external data ${outToday === 1 ? 'request' : 'requests'} recorded today.</p><hr>
    <dl><dt>Messages classified on this Mac</dt><dd>${S.inbox.length}</dd><dt>External requests, last 7 days</dt><dd>${outWeek}</dd><dt>Approved proposals</dt><dd>${approved}</dd></dl>`;
  const qy = ($('#audit-search')?.value || '').trim().toLowerCase();
  const shown = rows.filter(r => !qy || [AUDIT[r.kind] || r.kind,r.target,r.detail].join(' ').toLowerCase().includes(qy));
  $('#audit-count').textContent = qy ? `${shown.length} of ${rows.length}` : String(rows.length);
  let last = '';
  $('#audit').innerHTML = shown.length ? shown.map((r) => {
    const k = dayKey(r.at), head = k !== last ? `<li class="dayrow"><div class="day">${esc(cap(relDay(r.at)))}</div></li>` : ''; last = k;
    const out = EXTERNAL.includes(r.kind);
    return `${head}<li><time>${esc(hhmm(r.at))}</time><span class="node ${out ? 'out' : 'ok'}">${icon(out ? 'i-out' : r.kind === 'mensaje_aprobado' ? 'i-seal' : 'i-lock')}</span>
      <div><b>${esc(AUDIT[r.kind] || r.kind)}${r.target ? ` · ${esc(r.target)}` : ''}</b>${r.detail ? `<div class="d">${esc(r.detail)}</div>` : ''}</div></li>`;
  }).join('') : `<li class="dayrow"><div class="empty-state"><div><h3>${rows.length ? 'No matching activity' : 'No external activity recorded'}</h3><p>${rows.length ? 'Try another search.' : 'This list stays empty while you use only local AI.'}</p></div></div></li>`;
}
$('#audit-search').addEventListener('input', () => renderAudit().catch(err => toast(err.message, true)));

/* ---------------- Settings ---------------- */
function modelOptions(list, current) {
  const ids = [...new Set([current, ...list.map((m) => m.id)].filter(Boolean))];
  return ids.length ? ids.map((id) => `<option ${id === current ? 'selected' : ''}>${esc(id)}</option>`).join('') : '<option value="">Choose “Load models”</option>';
}
const sel = (name, value, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const keyState = (has) => has ? `<span class="pill ok">Stored in ${esc(displayText(S.settings.secretsWhere))}</span>` : '<span class="pill">No key</span>';

function renderSettings() {
  const s = S.settings;
  if (!draftAgents) draftAgents = s.agents.map((a) => ({ ...a }));
  const routeOpts = [['auto', 'Automatic'], ['local', 'Local AI only'], ['external', 'External AI']];
  const dp = S.presets.decision;
  $('#settings').innerHTML = `
  <header class="screen-intro settings-intro"><div><p class="eyebrow">SETTINGS</p><h2 class="title">Settings</h2><p class="lede">Set up your profile, AI providers, and data preferences.</p></div><span class="trust-note">${icon('i-lock')}Credentials stored in ${esc(displayText(s.secretsWhere))}</span></header>

  <form class="set-sec card form" data-sec="profile">
    <h3 class="sec">Your profile</h3>
    <p class="help">The assistant uses this to introduce itself and sign drafts.</p>
    <div class="row2" style="margin-top:12px"><label>Your name<input name="name" value="${esc(s.profile.name)}"></label><label>Business<input name="business" value="${esc(s.profile.business)}" placeholder="For example: Example Insurance"></label></div>
    <div class="row2" style="margin-top:12px"><label>Your profession<input name="sector" value="${esc(s.profile.sector)}" placeholder="Insurance broker, therapist, contractor…"></label><label>Message tone<input name="tone" value="${esc(s.profile.tone)}"></label></div>
    <div class="actions"><button class="btn primary">Save</button></div>
  </form>

  <form class="set-sec card form" data-sec="local">
    <h3 class="sec">${icon('i-chip')} Local AI (Ollama)</h3>
    <p class="help">Local inference runs on this Mac when an installed model is available. Install Ollama from ollama.com and choose a model. Recommended development setup: Mac with 24 GB memory and Qwen 3.5 9B or larger. Small models can confuse messages with tasks. Other configured integrations may still use the network.</p>
    <label class="toggle" style="margin-top:12px"><input type="checkbox" name="enabled" ${s.local.enabled ? 'checked' : ''}>Enable local AI</label>
    <div class="row2" style="margin-top:12px"><label>Address<input name="url" value="${esc(s.local.url)}"></label><label>Model<select name="model">${modelOptions(loadedModels.local, s.local.model)}</select></label></div>
    <p class="prop-warn model-warning" role="note" data-model-warning hidden></p>
    <div class="actions"><span class="note test-out" data-out></span><button type="button" class="btn" data-models="local">Load models</button><button type="button" class="btn" data-test="local">Test connection</button><button class="btn primary">Save</button></div>
  </form>

  <form class="set-sec card form" data-sec="external">
    <h3 class="sec">${icon('i-cloud')} External AI</h3>
    <p class="help">For more complex tasks. Supports OpenAI, Claude, Grok, Mistral, Gemini, OpenRouter, or an OpenAI-compatible API. Provider pricing applies.</p>
    <label class="toggle" style="margin-top:12px"><input type="checkbox" name="enabled" ${s.external.enabled ? 'checked' : ''}>Enable external AI</label>
    <div class="row2" style="margin-top:12px"><label>Proveedor${sel('preset', S.presets.external.find((p) => p.baseUrl === s.external.baseUrl && p.kind === s.external.kind)?.id || 'custom', S.presets.external.map((p) => [p.id, p.label]))}</label>
      <label>API address<input name="baseUrl" value="${esc(s.external.baseUrl)}"></label></div>
    <div class="row2" style="margin-top:12px"><label>Formato${sel('kind', s.external.kind, [['openai', 'OpenAI compatible'], ['anthropic', 'Anthropic']])}</label>
      <label>Model<input name="model" list="ext-models" value="${esc(s.external.model)}" placeholder="Choose “Load models” or enter a model name"><datalist id="ext-models">${loadedModels.external.map((m) => `<option value="${esc(m.id)}">`).join('')}</datalist></label></div>
    <label>API key<div style="display:flex;gap:8px;align-items:center"><input type="password" name="key" autocomplete="off" placeholder="Paste the key and choose “Save key”"><button type="button" class="btn" data-key="external">Save key</button></div></label>
    <p class="help">${keyState(s.keys.external)}</p>
    <div class="actions"><span class="note test-out" data-out></span><button type="button" class="btn" data-models="external">Load models</button><button type="button" class="btn" data-test="external">Test connection</button><button class="btn primary">Save</button></div>
  </form>

  <form class="set-sec card form" data-sec="decision">
    <h3 class="sec">${icon('i-bolt')} Fast classification (decision models)</h3>
    <p class="help">Decision models such as Jev or Clef choose among bounded options and return probabilities. Without a configured decision model, general AI performs classification. Provider pricing applies.</p>
    <div class="row2" style="margin-top:12px"><label>Service${sel('kind', s.decision.kind, [['none', 'None: use general AI'], ['typesafe', dp.typesafe.label], ['openrouter', `${dp.openrouter.label} (Jev, Clef…)`], ['custom', 'Compatible custom server']])}</label>
      <label>Model<input name="model" value="${esc(s.decision.model)}" placeholder="${esc(dp[s.decision.kind]?.model || '')}"></label></div>
    <p class="help">Model names: on TypeSafe, <code>jev-latest</code>. On OpenRouter, <code>typesafe/jev-1.13</code> or <code>cloudflare/clef-flash</code>. Verify the exact model name with the provider.</p>
    <label ${s.decision.kind === 'custom' ? '' : 'hidden'} data-custom>Server address<input name="url" value="${esc(s.decision.url)}" placeholder="https://…/v1/systemone"></label>
    <label>API key<div style="display:flex;gap:8px;align-items:center"><input type="password" name="key" autocomplete="off"><button type="button" class="btn" data-key="decision">Save key</button></div></label>
    <p class="help">${keyState(s.keys.decision)}</p>
    <div class="actions"><span class="note test-out" data-out></span><button type="button" class="btn" data-test="decision">Test connection</button><button class="btn primary">Save</button></div>
  </form>

  <form class="set-sec card form" data-sec="usage">
    <h3 class="sec">${icon('i-lock')} Choose AI provider y privacidad</h3>
    <div class="row3" style="grid-template-columns:1fr 1fr 1fr;margin-top:12px">
      <label>Assistant${sel('chat', s.routing.chat, routeOpts)}</label>
      <label>Respuestas a mensajes${sel('draft', s.routing.draft, routeOpts)}</label>
      <label>Classification${sel('triage', s.routing.triage, routeOpts)}</label>
    </div>
    <p class="help">Automatic uses local AI and falls back to external AI if configured.</p>
    <h3 class="sec" style="margin-top:18px">When client data goes to external AI</h3>
    ${[['anonymize', 'Anonimizar', 'Names, emails, phone numbers, Spanish ID numbers, and IBANs are replaced with markers where recognized. This is partial anonymization, not a guarantee that all personal data is removed.'],
       ['allow', 'Send unchanged', 'The external provider will receive actual client data.'],
       ['local-only', 'Keep AI processing on this Mac', 'Only local AI is used. External AI and external decision models are disabled.']]
      .map(([v, t, d]) => `<label class="radio"><input type="radio" name="privacy" value="${v}" ${s.privacy === v ? 'checked' : ''}><span><b>${t}</b><span>${d}</span></span></label>`).join('')}
    <p class="help">External errands are not anonymized. Review the actual recipient and data before approving delivery.</p>
    <div class="actions"><button class="btn primary">Save</button></div>
  </form>

  <section class="set-sec card" data-sec="agents">
    <h3 class="sec">${icon('i-send')} Agentes externos</h3>
    <p class="help">Prepare requests for configured external agents. Manual handoff opens an app; a configured A2A or webhook integration receives an approved request directly. Provider capabilities must be checked separately.</p>
    <div id="agents-list" style="margin-top:14px">${draftAgents.map((a, i) => agentForm(a, i, s.keys.agents[a.id])).join('') || '<p class="muted">No agents added yet.</p>'}</div>
    <div class="actions"><select id="agent-preset" style="height:30px;border:1px solid var(--rule);border-radius:7px;background:var(--surface);padding:0 8px">${S.presets.agents.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}</select>
      <button type="button" class="btn" id="add-agent">${icon('i-plus')}Add</button><button type="button" class="btn primary" id="save-agents">Save agents</button></div>
  </section>
  <section class="set-sec card">
    <h3 class="sec">Backups</h3>
    <p class="help">A local backup is saved on startup and every 24 hours. The latest 14 dates are retained; a new same-day backup replaces the earlier one. Keychain credentials are excluded.</p>
    ${S.backup?.scope === 'pyme1-only' ? '<p class="help" role="note">These backups cover REM only. To retain experimental email reviews and decisions, use a coordinated AWOS copy with the experiment closed.</p>' : ''}
    <p id="backup-status" role="status">Checking the latest backup…</p>
    <div class="actions"><button type="button" class="btn" id="backup-reveal" disabled>Show in Finder</button><button type="button" class="btn primary" id="backup-now">Back up now</button></div>
  </section>
  <section class="set-sec card">
    <h3 class="sec">Sample data</h3>
    <p class="help">Load a fictional Spanish insurance brokerage with clients, tasks, classified messages, and proposals for demonstrations. A backup is saved first. This also sets the sample profile name to Laura Medina.</p>
    <div class="actions"><span class="note" id="demo-note"></span><button type="button" class="btn" id="load-demo">Load sample data</button></div>
  </section>
  <section class="set-sec card">
    <h3 class="sec">Quit the application</h3>
    <p class="help">Stop REM on this Mac. Your data is retained. Open the app to return.</p>
    <div class="actions"><button type="button" class="btn danger" id="shutdown-app">Quit REM</button></div>
  </section>`;
  refreshBackupStatus();
  refreshModelWarning();
  loadModelCapacity();
}
function refreshModelWarning() {
  const form = $('[data-sec="local"]'), slot = $('[data-model-warning]');
  if (!form || !slot) return;
  const metadata = form.url.value === loadedLocalUrl ? loadedModels.local.find(m => m.id === form.model.value) : null;
  const warning = smallModelWarning(form.model.value, metadata || {});
  slot.textContent = warning;
  slot.hidden = !warning;
}
async function loadModelCapacity() {
  const url = S.settings.local.url;
  if (loadedLocalUrl === url || capacityRequest?.url === url) return;
  const request = { url }; capacityRequest = request;
  try {
    const models = await api('/api/models/local');
    if (capacityRequest !== request || S.settings.local.url !== url) return;
    loadedModels.local = models; loadedLocalUrl = url;
    // No reconstruimos el formulario: preservar cambios que aún no se han guardado.
    refreshModelWarning();
  } catch { /* Si Ollama no responde, la inferencia por nombre sigue funcionando. */ }
  finally { if (capacityRequest === request) capacityRequest = null; }
}
async function refreshBackupStatus() {
  try {
    const b = await api('/api/backups');
    const slot = $('#backup-status');
    if (!slot) return;
    slot.textContent = (b.notice ? displayText(b.notice) + ' ' : '') + (b.error || (b.last ? `Latest backup: ${fmtDate(b.last.at)}. ${b.count} of ${b.retention} dates retained.` : 'No backups yet.'));
    $('#backup-reveal').disabled = !b.last;
  } catch (err) { const slot = $('#backup-status'); if (slot) slot.textContent = err.message; }
}
function agentForm(a, i, hasKey) {
  const api = a.kind === 'a2a' || a.kind === 'webhook';
  return `<div class="agent form" data-agent="${i}">
    <div class="row3"><label>Name<input name="name" value="${esc(a.name)}"></label>
      <label>Connection method${sel('kind', a.kind, [['chat', 'Opening the app (no API)'], ['a2a', 'API A2A'], ['webhook', 'Webhook']])}</label>
      <label>${api ? 'API address' : 'App'}${api ? `<input name="url" value="${esc(a.url)}" placeholder="https://…">` : sel('app', a.app, [['imessage', 'iMessage'], ['whatsapp', 'WhatsApp'], ['web', 'Website or app']])}</label></div>
    ${api ? '' : `<div class="row2" style="margin-top:10px"><label>Contact (phone or handle)<input name="handle" value="${esc(a.handle)}"></label><label>Opening link<input name="openUrl" value="${esc(a.openUrl)}" placeholder="https://…"></label></div>`}
    ${a.notes ? `<p class="help">${esc(a.notes)}</p>` : ''}
    <div class="actions">${api ? `<span class="note">${keyState(hasKey)}</span><input type="password" data-agent-key placeholder="Key (optional)" style="max-width:200px"><button type="button" class="btn small" data-agent-savekey="${i}">Save key</button>` : '<span class="note"></span>'}
      <span class="test-out" data-out></span><button type="button" class="btn small" data-agent-test="${i}">Test connection</button><button type="button" class="btn small ghost danger" data-agent-del="${i}">${icon('i-trash')}</button></div>
  </div>`;
}
function readAgents() {
  $$('[data-agent]').forEach((f) => {
    const a = draftAgents[Number(f.dataset.agent)];
    for (const el of $$('[name]', f)) a[el.name] = el.value;
  });
}
const settingsBox = $('#settings');
settingsBox.addEventListener('change', (e) => {
  const f = e.target.closest('form');
  if (f?.dataset.sec === 'local') refreshModelWarning();
  if (e.target.name === 'preset' && f?.dataset.sec === 'external') {
    const p = S.presets.external.find((x) => x.id === e.target.value);
    if (p) { f.baseUrl.value = p.baseUrl; f.kind.value = p.kind; }
  }
  if (e.target.name === 'kind' && f?.dataset.sec === 'decision') {
    $('[data-custom]', f).hidden = e.target.value !== 'custom';
    f.model.placeholder = S.presets.decision[e.target.value]?.model || '';
  }
  if (e.target.name === 'kind' && e.target.closest('[data-agent]')) { readAgents(); renderSettings(); }
});
async function saveSection(f) {
  const sec = f.dataset.sec;
  let body;
  if (sec === 'profile') body = { profile: { name: f.name.value, business: f.business.value, sector: f.sector.value, tone: f.tone.value } };
  if (sec === 'local') body = { local: { enabled: f.enabled.checked, url: f.url.value, model: f.model.value } };
  if (sec === 'external') {
    const preset = S.presets.external.find((p) => p.id === f.preset.value);
    body = { external: { enabled: f.enabled.checked, kind: f.kind.value, baseUrl: f.baseUrl.value, model: f.model.value, label: preset && preset.id !== 'custom' ? preset.label : '' } };
  }
  if (sec === 'decision') body = { decision: { kind: f.kind.value, model: f.model.value, url: f.url.value } };
  if (sec === 'usage') body = { routing: { chat: f.chat.value, draft: f.draft.value, triage: f.triage.value }, privacy: f.privacy.value };
  S.settings = await api('/api/settings', { method: 'POST', body });
  renderSide(); renderChat();
}
settingsBox.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await saveSection(e.target); toast('Guardado'); renderSettings(); renderChat(); } catch (err) { toast(err.message, true); }
});
settingsBox.addEventListener('click', async (e) => {
  const f = e.target.closest('form');
  const out = (msg, ok) => { const o = $('[data-out]', e.target.closest('.form') || f || settingsBox); if (o) { o.textContent = msg; o.className = `note test-out ${ok ? 'ok' : 'bad'}`; } };
  try {
    const backupButton = e.target.closest('#backup-now, #backup-reveal');
    if (backupButton) {
      backupButton.disabled = true;
      try {
        await api(backupButton.id === 'backup-now' ? '/api/backups' : '/api/backups/reveal', { method: 'POST', body: {} });
        toast(backupButton.id === 'backup-now' ? 'Backup saved' : 'Backup shown in Finder');
      } finally { backupButton.disabled = false; await refreshBackupStatus(); }
      return;
    }
    const demo = e.target.closest('#load-demo');
    if (demo) {
      const force = demo.dataset.confirm === '1';
      demo.disabled = true;
      try {
        await api('/api/demo', { method: 'POST', body: { forzar: force } });
        Object.assign(S, await api('/api/state')); S.audit = await api('/api/audit').catch(() => []); S.backup = await api('/api/backups').catch(() => null);
        renderSide(); renderChat(); renderInbox(); renderPending(); renderClients(); renderTasks(); renderErrands();
        toast('Sample data loaded'); go('hoy');
      } catch (err) {
        if (!force && /Ya tienes datos/.test(err.message)) { demo.dataset.confirm = '1'; demo.textContent = 'Add anyway'; $('#demo-note').textContent = err.message; }
        else toast(err.message, true);
      } finally { demo.disabled = false; }
      return;
    }
    if (e.target.closest('#shutdown-app')) {
      if (!confirm('Quit REM? Your data will be retained.')) return;
      await api('/api/shutdown', { method: 'POST' });
      document.body.innerHTML = '<main style="padding:40px"><h1>REM has stopped</h1><p>You can close this tab. Open the app to return.</p></main>';
      return;
    }
    const m = e.target.closest('[data-models]');
    if (m) {
      await saveSection(f); m.disabled = true; out('Cargando…', true);
      loadedModels[m.dataset.models] = await api(`/api/models/${m.dataset.models}`);
      if (m.dataset.models === 'local') loadedLocalUrl = S.settings.local.url;
      renderSettings();
      toast(loadedModels[m.dataset.models].length ? `${loadedModels[m.dataset.models].length} modelos disponibles` : 'No models found. Download one in Ollama first.', !loadedModels[m.dataset.models].length);
      return;
    }
    const t = e.target.closest('[data-test]');
    if (t) {
      await saveSection(f); t.disabled = true; out('Probando…', true);
      const r = await api(`/api/test/${t.dataset.test}`, { method: 'POST' });
      out(`Funciona (${(r.ms / 1000).toFixed(1)} s)${r.sample ? `: ${r.sample}` : ''}`, true); t.disabled = false; return;
    }
    const k = e.target.closest('[data-key]');
    if (k) {
      const value = f.key.value.trim(); if (!value) { out('Paste the key first.', false); return; }
      S.settings = await api('/api/secrets', { method: 'POST', body: { name: k.dataset.key, value } });
      toast('Key saved'); renderSettings(); return;
    }
    if (e.target.closest('#add-agent')) {
      readAgents();
      const p = S.presets.agents[Number($('#agent-preset').value)];
      draftAgents.push({ id: `${p.name.toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '')}-${Math.random().toString(36).slice(2, 6)}`, name: p.name, kind: p.kind, app: p.app, url: '', handle: '', openUrl: '', notes: p.notes });
      renderSettings(); return;
    }
    const del = e.target.closest('[data-agent-del]');
    if (del) { readAgents(); draftAgents.splice(Number(del.dataset.agentDel), 1); renderSettings(); return; }
    if (e.target.closest('#save-agents')) {
      readAgents();
      S.settings = await api('/api/settings', { method: 'POST', body: { agents: draftAgents } });
      draftAgents = null; toast('Saved agents'); renderSettings(); renderErrands(); return;
    }
    const sk = e.target.closest('[data-agent-savekey]');
    if (sk) {
      readAgents();
      S.settings = await api('/api/settings', { method: 'POST', body: { agents: draftAgents } });
      const box = sk.closest('[data-agent]'); const a = draftAgents[Number(sk.dataset.agentSavekey)];
      S.settings = await api('/api/secrets', { method: 'POST', body: { name: `agent:${a.id}`, value: $('[data-agent-key]', box).value } });
      draftAgents = null; toast('Key saved'); renderSettings(); return;
    }
    const at = e.target.closest('[data-agent-test]');
    if (at) {
      readAgents();
      S.settings = await api('/api/settings', { method: 'POST', body: { agents: draftAgents } });
      const a = draftAgents[Number(at.dataset.agentTest)];
      const r = await api(`/api/test/agent/${encodeURIComponent(a.id)}`, { method: 'POST' });
      out(r.note || 'Funciona', true); return;
    }
  } catch (err) {
    out(err.message, false); $$('[data-test],[data-models]', settingsBox).forEach((b) => (b.disabled = false));
  }
});

/* ---------------- Arranque ---------------- */
const moduleLibrary=mountModuleLibrary({api,onOpen:item=>{go(MODULE_KINDS[item.manifest.kind].route);activeRemModule={id:item.manifest.id,kind:item.manifest.kind};document.dispatchEvent(new CustomEvent('rem-module-open',{detail:{kind:item.manifest.kind,id:item.manifest.id,title:item.installation?.config.title??item.manifest.name,subtitle:item.installation?.config.subtitle??item.manifest.description}}));}});
const copiesUI=mountCopies({api}),requestedView=location.hash.slice(1);
(async()=>{
 await loadAroundMaintenance(load,async()=>{document.getElementById('awos-form').hidden=true;go('awos');await copiesUI?.refresh();});
 document.getElementById('awos-form').hidden=false;await mountAwos({api});await mountIntakes({api})?.refresh().catch(()=>{});await copiesUI?.refresh();go(requestedView||aiReadyOrSettings());document.getElementById('main').setAttribute('aria-busy','false');
})().catch(e=>{
 copiesUI?.stop();document.body.innerHTML=`<main class="page"><div class="inline-notice error" role="alert"><strong>Cannot connect to REM</strong><p>${esc(e.message)}. Close this tab and open the app again.</p></div></main>`;
});
function aiReadyOrSettings() { return aiReady() ? 'hoy' : 'ajustes'; }
document.addEventListener('keydown', (e) => {
  if(!S)return;
  if (!(e.metaKey || e.ctrlKey)) return;
  const order = ['hoy', 'asistente', 'clasificar', 'aprobaciones', 'clientes', 'tareas', 'encargos', 'registro'];
  const n = Number(e.key);
  if (n >= 1 && n <= order.length) { e.preventDefault(); go(order[n - 1]); }
  if (e.key === ',') { e.preventDefault(); go('ajustes'); }
});

// Navigation only: opening a prepared contact never submits a proposal or decision.
document.addEventListener('click',e=>{const b=e.target.closest('[data-intake-review]');if(!b||!S?.awosIntakesEnabled)return;go('clasificar');document.dispatchEvent(new CustomEvent('awos-intake-select',{detail:{messageId:Number(b.dataset.intakeReview)}}));});
document.addEventListener('rem-module-exit',()=>{activeRemModule=null;});
document.addEventListener('rem-module-open',e=>{if(e.detail.kind==='requests')document.querySelector('[data-intake-paste] textarea')?.focus();});
document.addEventListener('awos-intake-propose',()=>{activeRemModule=null;if(S?.awosIntakesEnabled)go('awos');});
document.addEventListener('awos-intakes-changed',()=>load().catch(e=>toast(e.message,true)));
