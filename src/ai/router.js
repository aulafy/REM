// Decide qué IA atiende cada petición y aplica la política de privacidad.
import { chatLocal, chatExternal, AiError } from './providers.js';
import { callDecision, emulationPrompt, emulatedToAnswers, decisionSchema, DECISION_PROVIDERS } from './decision.js';
import { makeAnonymizer } from './anonymize.js';
import { extractJson } from './json.js';

const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };

export function externalLabel(s) {
  return s.external.label || hostOf(s.external.baseUrl) || 'IA externa';
}

// ctx: { db, secrets, settings(), providers? }  (providers se puede sustituir en las pruebas)
export async function runChat(ctx, task, { system, messages, json = false, schema, prefer } = {}) {
  const s = ctx.settings();
  const mode = prefer || s.routing[task] || 'auto';
  const canLocal = s.local.enabled && !!s.local.model;
  const canExternal = s.external.enabled && !!s.external.model && s.privacy !== 'local-only';
  const order = mode === 'local' ? ['local'] : mode === 'external' ? ['external'] : ['local', 'external'];
  const p = ctx.providers || { chatLocal, chatExternal };
  let lastErr = null;

  for (const target of order) {
    if (target === 'local' && !canLocal) { lastErr ||= new AiError('NOT_CONFIGURED', 'La IA local no está configurada. Elige un modelo en Ajustes.'); continue; }
    if (target === 'external' && !canExternal) {
      lastErr ||= new AiError('NOT_CONFIGURED', s.privacy === 'local-only'
        ? 'Tu configuración de privacidad no permite usar IAs externas.'
        : 'La IA externa no está configurada.');
      continue;
    }
    try {
      if (target === 'local') {
        const r = await p.chatLocal(s.local, { system, messages, json, schema });
        return { text: r.text, via: { target: 'local', label: 'IA local', model: s.local.model, anonymized: false, fallback: target !== order[0] } };
      }
      const key = await ctx.secrets.get('external');
      let sys = system, msgs = messages, anon = null;
      if (s.privacy === 'anonymize') {
        anon = makeAnonymizer(ctx.db.clients.list().map((c) => c.name));
        sys = anon.anonymize(system);
        msgs = messages.map((m) => ({ ...m, content: anon.anonymize(m.content) }));
      }
      const r = await p.chatExternal(s.external, key, { system: sys, messages: msgs, json });
      const chars = (sys || '').length + msgs.reduce((n, m) => n + m.content.length, 0);
      ctx.db.audit.add('ia_externa', `${externalLabel(s)} · ${s.external.model}`,
        `${chars} caracteres enviados para «${task}». ${anon ? `Anonimizados ${anon.count} datos personales.` : 'Sin anonimizar.'}`);
      return {
        text: anon ? anon.restore(r.text) : r.text,
        via: { target: 'external', label: externalLabel(s), model: s.external.model, anonymized: !!anon, fallback: target !== order[0] },
      };
    } catch (e) {
      lastErr = e;
      // Solo se pasa a la siguiente IA si esta no está disponible (no si da otro error).
      if (!(mode === 'auto' && (e.code === 'UNREACHABLE' || e.code === 'TIMEOUT'))) throw e;
    }
  }
  throw lastErr || new AiError('NOT_CONFIGURED', 'No hay ninguna IA configurada.');
}

export async function runJson(ctx, task, req) {
  const r = await runChat(ctx, task, { ...req, json: true });
  return { data: extractJson(r.text), text: r.text, via: r.via };
}

// Clasificación rápida: Jev/Clef si están configurados; si no (o si fallan), el modelo general.
export async function runDecision(ctx, { state, questions, prefer }) {
  const s = ctx.settings();
  const d = s.decision;
  let fallbackReason = '';
  if (prefer !== 'local' && d.kind !== 'none' && s.privacy !== 'local-only') {
    try {
      const key = await ctx.secrets.get('decision');
      if (!key && d.kind !== 'custom') throw new AiError('NOT_CONFIGURED', 'Falta la clave del modelo de decisión.');
      let st = state, anon = null;
      if (s.privacy === 'anonymize') {
        anon = makeAnonymizer(ctx.db.clients.list().map((c) => c.name));
        st = typeof state === 'string' ? anon.anonymize(state) : JSON.parse(anon.anonymize(JSON.stringify(state)));
      }
      const call = ctx.callDecision || callDecision;
      const r = await call(d, key, { state: st, questions });
      ctx.db.audit.add('decision_externa', `${DECISION_PROVIDERS[d.kind].label} · ${r.model}`,
        `Clasificación de un mensaje. ${anon ? `Anonimizados ${anon.count} datos personales.` : 'Sin anonimizar.'}`);
      return { answers: r.answers, via: { target: 'decision', label: DECISION_PROVIDERS[d.kind].label, model: r.model, anonymized: !!anon, emulated: false } };
    } catch (e) {
      fallbackReason = e.message;
    }
  }
  const prompt = emulationPrompt({ state, questions });
  const r = await runJson(ctx, 'triage', { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], schema: decisionSchema(questions), prefer });
  return { answers: emulatedToAnswers(r.data, questions), via: { ...r.via, emulated: true, fallbackReason } };
}
