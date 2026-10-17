// Adaptadores de modelos de lenguaje: Ollama (local), API compatible con OpenAI y Anthropic.
export class AiError extends Error {
  constructor(code, message, cause) { super(message); this.code = code; this.cause = cause; }
}

const TIMEOUT = { local: 180_000, external: 120_000, test: 20_000 };
const trim = (u) => String(u || '').replace(/\/+$/, '');

async function request(url, { method = 'POST', body, headers = {}, timeout }) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    if (e.name === 'TimeoutError') throw new AiError('TIMEOUT', `${host} ha tardado demasiado en responder.`, e);
    throw new AiError('UNREACHABLE', `No se puede conectar con ${host}.`, e);
  }
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* no es JSON */ }
  if (!res.ok) {
    const detail = data?.error?.message || data?.error || data?.message || text.slice(0, 200);
    const code = res.status === 401 || res.status === 403 ? 'AUTH' : res.status === 429 ? 'RATE_LIMIT' : res.status === 404 ? 'NOT_FOUND' : `HTTP_${res.status}`;
    const human = code === 'AUTH' ? 'La clave de API no es válida o no tiene permiso.'
      : code === 'RATE_LIMIT' ? 'Has superado el límite de uso del proveedor. Prueba en un rato.'
      : code === 'NOT_FOUND' ? 'El proveedor no encuentra ese modelo o esa dirección.'
      : `El proveedor respondió con un error (${res.status}).`;
    throw new AiError(code, `${human} ${typeof detail === 'string' ? detail : ''}`.trim());
  }
  return data;
}

const sysMessages = (system, messages) => [...(system ? [{ role: 'system', content: system }] : []), ...messages];

// ---------- Ollama ----------
async function ollamaChat(cfg, { system, messages, schema, json }, timeout = TIMEOUT.local) {
  if (!cfg.model) throw new AiError('NOT_CONFIGURED', 'Elige un modelo local en Ajustes.');
  const url = `${trim(cfg.url)}/api/chat`;
  const body = {
    model: cfg.model, stream: false, keep_alive: '15m', options: { temperature: 0.2 },
    // Los modelos con «razonamiento» (Qwen 3, DeepSeek R1…) piensan antes de contestar y tardan
    // minutos. Para estas tareas no hace falta: se desactiva.
    think: false,
    ...(schema ? { format: schema } : json ? { format: 'json' } : {}),
    messages: sysMessages(system, messages),
  };
  let data;
  try {
    data = await request(url, { timeout, body });
  } catch (e) {
    // Versiones antiguas de Ollama o modelos que no aceptan «think»: se repite sin él.
    if (!(e instanceof AiError) || !String(e.code).startsWith('HTTP_4')) throw e;
    const { think, ...rest } = body;
    data = await request(url, { timeout, body: rest });
  }
  const text = String(data?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, usage: { input: data?.prompt_eval_count ?? 0, output: data?.eval_count ?? 0 } };
}

async function ollamaModels(cfg) {
  const data = await request(`${trim(cfg.url)}/api/tags`, { method: 'GET', timeout: TIMEOUT.test });
  return (data?.models || []).map((m) => ({ id: m.name, size: m.size, parameterSize: m.details?.parameter_size || '', quantization: m.details?.quantization_level || '' }));
}

// ---------- Compatible con OpenAI (OpenAI, xAI, Mistral, Gemini, OpenRouter…) ----------
async function openaiChat(cfg, key, { system, messages, json }, timeout = TIMEOUT.external) {
  if (!cfg.model) throw new AiError('NOT_CONFIGURED', 'Elige un modelo externo en Ajustes.');
  const url = `${trim(cfg.baseUrl)}/chat/completions`;
  const headers = key ? { authorization: `Bearer ${key}` } : {};
  const body = { model: cfg.model, temperature: 0.2, messages: sysMessages(system, messages) };
  if (json) body.response_format = { type: 'json_object' };
  let data;
  try {
    data = await request(url, { body, headers, timeout });
  } catch (e) {
    // Algunos modelos no aceptan temperature o response_format: se reintenta una vez sin ellos.
    if (e.code !== 'HTTP_400') throw e;
    data = await request(url, { body: { model: cfg.model, messages: body.messages }, headers, timeout });
  }
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((p) => p.text || '').join('') : (content ?? '');
  return { text, usage: { input: data?.usage?.prompt_tokens ?? 0, output: data?.usage?.completion_tokens ?? 0 } };
}

async function openaiModels(cfg, key) {
  const data = await request(`${trim(cfg.baseUrl)}/models`, { method: 'GET', headers: key ? { authorization: `Bearer ${key}` } : {}, timeout: TIMEOUT.test });
  return (data?.data || []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- Anthropic ----------
function alternate(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n\n${m.content}`;
    else out.push({ role, content: m.content });
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(inicio de la conversación)' });
  return out;
}

async function anthropicChat(cfg, key, { system, messages, json }, timeout = TIMEOUT.external) {
  if (!cfg.model) throw new AiError('NOT_CONFIGURED', 'Elige un modelo externo en Ajustes.');
  const data = await request(`${trim(cfg.baseUrl || 'https://api.anthropic.com')}/v1/messages`, {
    timeout,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: {
      model: cfg.model, max_tokens: 2000, temperature: 0.2,
      system: json ? `${system || ''}\n\nResponde únicamente con un objeto JSON válido.`.trim() : system,
      messages: alternate(messages),
    },
  });
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, usage: { input: data?.usage?.input_tokens ?? 0, output: data?.usage?.output_tokens ?? 0 } };
}

async function anthropicModels(cfg, key) {
  const data = await request(`${trim(cfg.baseUrl || 'https://api.anthropic.com')}/v1/models`, {
    method: 'GET', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout: TIMEOUT.test,
  });
  return (data?.data || []).map((m) => ({ id: m.id }));
}

// ---------- Interfaz común ----------
export async function chatLocal(cfg, req, timeout) { return ollamaChat(cfg, req, timeout); }

export async function chatExternal(cfg, key, req, timeout) {
  if (!key && cfg.kind === 'anthropic') throw new AiError('NOT_CONFIGURED', 'Falta la clave de API de la IA externa.');
  return cfg.kind === 'anthropic' ? anthropicChat(cfg, key, req, timeout) : openaiChat(cfg, key, req, timeout);
}

export async function listModels(target, cfg, key) {
  if (target === 'local') return ollamaModels(cfg);
  return cfg.kind === 'anthropic' ? anthropicModels(cfg, key) : openaiModels(cfg, key);
}

export async function ping(target, cfg, key) {
  const req = { system: 'Responde solo con la palabra: ok', messages: [{ role: 'user', content: 'Prueba de conexión' }] };
  const started = Date.now();
  const r = target === 'local' ? await chatLocal(cfg, req, TIMEOUT.test * 3) : await chatExternal(cfg, key, req, TIMEOUT.test * 2);
  return { ok: true, ms: Date.now() - started, sample: r.text.slice(0, 40) };
}
