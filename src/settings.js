// Ajustes con valores por defecto y validación. Las claves de API nunca se guardan aquí.
export const DEFAULTS = {
  language: null,
  profile: { name: '', business: '', sector: '', tone: 'cercano y profesional' },
  local: { enabled: true, url: 'http://127.0.0.1:11434', model: '' },
  external: { enabled: false, kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', label: '' },
  // kind: none | typesafe | openrouter | custom
  decision: { kind: 'none', model: '', url: '' },
  // auto = IA local y, si no responde, la externa
  routing: { chat: 'auto', draft: 'auto', triage: 'auto' },
  // anonymize | allow | local-only
  privacy: 'anonymize',
  agents: [],
};

// Proveedores con API compatible con OpenAI. Comprueba la URL en la documentación de cada uno.
export const EXTERNAL_PRESETS = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'openrouter', label: 'OpenRouter (muchos modelos)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'custom', label: 'Otro compatible con OpenAI', kind: 'openai', baseUrl: '' },
];

const ROUTES = ['auto', 'local', 'external'];
const isUrl = (u) => { try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; } };
const str = (v, max = 500) => String(v ?? '').slice(0, max).trim();

export class ValidationError extends Error { constructor(msg) { super(msg); this.code = 'VALIDATION'; } }

export function loadSettings(db) {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = db.getSetting(k, undefined);
    out[k] = Array.isArray(def) ? (Array.isArray(v) ? v : def) : (def && typeof def === 'object' ? { ...def, ...(v || {}) } : (v ?? def));
  }
  return out;
}

export function saveSettings(db, patch) {
  const cur = loadSettings(db);
  if (patch.language !== undefined) {
    if (!['es', 'en'].includes(patch.language)) throw new ValidationError('Elige español o inglés.');
    db.setSetting('language', patch.language);
  }
  if (patch.profile) {
    const p = patch.profile;
    db.setSetting('profile', { name: str(p.name, 80), business: str(p.business, 120), sector: str(p.sector, 120), tone: str(p.tone || cur.profile.tone, 120) });
  }
  if (patch.local) {
    const l = { ...cur.local, ...patch.local };
    if (!isUrl(l.url)) throw new ValidationError('La dirección de la IA local no es válida.');
    db.setSetting('local', { enabled: !!l.enabled, url: str(l.url), model: str(l.model, 200) });
  }
  if (patch.external) {
    const e = { ...cur.external, ...patch.external };
    if (!['openai', 'anthropic'].includes(e.kind)) throw new ValidationError('Tipo de IA externa no válido.');
    if (e.baseUrl && !isUrl(e.baseUrl)) throw new ValidationError('La dirección de la IA externa no es válida.');
    db.setSetting('external', { enabled: !!e.enabled, kind: e.kind, baseUrl: str(e.baseUrl), model: str(e.model, 200), label: str(e.label, 60) });
  }
  if (patch.decision) {
    const d = { ...cur.decision, ...patch.decision };
    if (!['none', 'typesafe', 'openrouter', 'custom'].includes(d.kind)) throw new ValidationError('Tipo de modelo de decisión no válido.');
    if (d.kind === 'custom' && !isUrl(d.url)) throw new ValidationError('Indica la dirección del modelo de decisión.');
    db.setSetting('decision', { kind: d.kind, model: str(d.model, 200), url: str(d.url) });
  }
  if (patch.routing) {
    const r = { ...cur.routing, ...patch.routing };
    for (const k of Object.keys(DEFAULTS.routing)) if (!ROUTES.includes(r[k])) throw new ValidationError('Modo de uso de IA no válido.');
    db.setSetting('routing', { chat: r.chat, draft: r.draft, triage: r.triage });
  }
  if (patch.privacy !== undefined) {
    if (!['anonymize', 'allow', 'local-only'].includes(patch.privacy)) throw new ValidationError('Opción de privacidad no válida.');
    db.setSetting('privacy', patch.privacy);
  }
  if (patch.agents) {
    if (!Array.isArray(patch.agents) || patch.agents.length > 20) throw new ValidationError('Lista de agentes no válida.');
    const agents = patch.agents.map((a, i) => {
      const kind = a.kind;
      if (!['a2a', 'webhook', 'chat'].includes(kind)) throw new ValidationError('Tipo de agente no válido.');
      const agent = {
        id: str(a.id || `agente-${Date.now().toString(36)}-${i}`, 60).replace(/[^\w-]/g, ''),
        name: str(a.name, 60) || 'Agente',
        kind,
        url: str(a.url),
        handle: str(a.handle, 120),
        app: ['whatsapp', 'imessage', 'web'].includes(a.app) ? a.app : 'web',
        openUrl: str(a.openUrl),
        notes: str(a.notes, 300),
      };
      if ((kind === 'a2a' || kind === 'webhook') && !isUrl(agent.url)) throw new ValidationError(`Falta la dirección de la API de ${agent.name}.`);
      if (agent.openUrl && !isUrl(agent.openUrl)) throw new ValidationError(`El enlace para abrir ${agent.name} no es válido.`);
      return agent;
    });
    db.setSetting('agents', agents);
  }
  return loadSettings(db);
}
