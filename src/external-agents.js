// Encargos a agentes de IA externos.
//  - a2a:     agentes con el protocolo Agent2Agent (JSON-RPC "message/send").
//  - webhook: cualquier servicio que reciba un POST con el encargo.
//  - chat:    agentes de consumo sin API pública (Instinct, Muse, Grok Bot…): se prepara el encargo
//             para abrirlo en su app o pegarlo en su chat. La persona lo entrega y pega la respuesta.
import { randomUUID } from 'node:crypto';
import { AiError } from './ai/providers.js';

export const AGENT_PRESETS = [
  { name: 'Instinct', kind: 'chat', app: 'imessage', notes: 'Se le escribe por iMessage o WhatsApp. Pon aquí el contacto que usas con tu Instinct. Acceso solo por invitación.' },
  { name: 'Muse', kind: 'chat', app: 'web', notes: 'Agente de Meta. Por ahora solo disponible en EE. UU.' },
  { name: 'Grok Bot', kind: 'chat', app: 'web', notes: 'Agente de xAI, en beta para algunos suscriptores de pago.' },
  { name: 'Agente con API (A2A)', kind: 'a2a', app: 'web', notes: 'Cualquier agente compatible con el protocolo Agent2Agent.' },
  { name: 'Servicio propio (webhook)', kind: 'webhook', app: 'web', notes: 'Recibe un POST con {id, encargo, origen} y puede devolver {respuesta}.' },
];

async function post(url, body, key, timeout = 60_000) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new AiError(e.name === 'TimeoutError' ? 'TIMEOUT' : 'UNREACHABLE', `No se puede conectar con el agente (${new URL(url).host}).`, e);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AiError(res.status === 401 || res.status === 403 ? 'AUTH' : `HTTP_${res.status}`, `El agente respondió con un error (${res.status}).`);
  return data;
}

const partsText = (parts = []) => parts.filter((p) => (p.kind || p.type) === 'text' && p.text).map((p) => p.text).join('\n');

export function fromA2A(result) {
  if (!result) return { status: 'enviado' };
  if ((result.kind || result.type) === 'message' || (Array.isArray(result.parts) && !result.status)) {
    return { status: 'respondido', response: partsText(result.parts) };
  }
  const state = result.status?.state;
  const artifacts = (result.artifacts || []).map((a) => partsText(a.parts)).filter(Boolean).join('\n\n');
  const msg = partsText(result.status?.message?.parts);
  const response = [artifacts, msg].filter(Boolean).join('\n\n');
  const remoteId = result.id || '';
  if (state === 'completed') return { status: 'respondido', response, remoteId };
  if (['failed', 'rejected', 'canceled'].includes(state)) return { status: 'fallido', response: msg || 'El agente no pudo completar el encargo.', remoteId };
  if (state === 'input-required') return { status: 'necesita_info', response: msg, remoteId };
  return { status: 'enviado', response, remoteId };
}

export function handoff(agent, brief) {
  const enc = encodeURIComponent(brief);
  const links = [];
  const digits = (agent.handle || '').replace(/\D/g, '');
  if (agent.app === 'whatsapp' && digits) links.push({ label: `Abrir en WhatsApp`, href: `https://wa.me/${digits}?text=${enc}` });
  if (agent.app === 'imessage' && agent.handle) links.push({ label: 'Abrir en Mensajes', href: `sms:${agent.handle}&body=${enc}` });
  if (agent.openUrl) links.push({ label: `Abrir ${agent.name}`, href: agent.openUrl });
  return { text: brief, links };
}

export async function dispatch(agent, key, brief, ref) {
  if (agent.kind === 'chat') return { status: 'entregar_a_mano', handoff: handoff(agent, brief) };
  if (agent.kind === 'webhook') {
    const data = await post(agent.url, { id: String(ref), encargo: brief, origen: 'Pyme_1' }, key);
    const text = data && (data.respuesta ?? data.result ?? data.text ?? data.output);
    return text ? { status: 'respondido', response: String(text) } : { status: 'enviado', remoteId: String(data?.id ?? '') };
  }
  if (agent.kind === 'a2a') {
    const data = await post(agent.url, {
      jsonrpc: '2.0', id: String(ref), method: 'message/send',
      params: { message: { role: 'user', messageId: randomUUID(), parts: [{ kind: 'text', text: brief }] } },
    }, key);
    if (data?.error) throw new AiError('AGENT_ERROR', `El agente no aceptó el encargo: ${data.error.message || 'error desconocido'}.`);
    return fromA2A(data?.result);
  }
  throw new AiError('NOT_CONFIGURED', 'Tipo de agente no válido.');
}

export async function refresh(agent, key, remoteId) {
  if (agent.kind !== 'a2a' || !remoteId) return null;
  const data = await post(agent.url, { jsonrpc: '2.0', id: randomUUID(), method: 'tasks/get', params: { id: remoteId } }, key);
  if (data?.error) throw new AiError('AGENT_ERROR', `El agente no devolvió el encargo: ${data.error.message || 'error desconocido'}.`);
  return fromA2A(data?.result);
}

export async function testAgent(agent, key) {
  if (agent.kind === 'chat') return { ok: true, note: 'Este agente se usa abriendo su app; no hay conexión que probar.' };
  if (agent.kind === 'a2a') {
    // Intenta leer la tarjeta pública del agente (agent card).
    const base = new URL(agent.url);
    for (const path of ['/.well-known/agent-card.json', '/.well-known/agent.json']) {
      try {
        const r = await fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) });
        if (r.ok) { const card = await r.json(); return { ok: true, note: `Conectado con «${card.name || agent.name}».` }; }
      } catch { /* prueba la siguiente */ }
    }
    throw new AiError('UNREACHABLE', 'No encuentro la tarjeta del agente (/.well-known/agent-card.json).');
  }
  return { ok: true, note: 'La dirección es válida. Se comprobará al enviar el primer encargo.' };
}
