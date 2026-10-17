// Ejecutar (o descartar) lo que el agente propuso. Solo se llega aquí con una aprobación humana.
import { normalizeAction } from './agent.js';
import { dispatch } from './external-agents.js';
import { ValidationError } from './settings.js';

export class NotFoundError extends Error { constructor(msg) { super(msg); this.code = 'NOT_FOUND'; } }

const enc = encodeURIComponent;

export function messageLinks(client, payload) {
  const links = [];
  const email = client?.email;
  if (email) links.push({ label: 'Abrir en Mail', href: `mailto:${email}?subject=${enc(payload.asunto || '')}&body=${enc(payload.texto)}` });
  let digits = (client?.phone || '').replace(/\D/g, '');
  if (digits.length === 9 && /^[6789]/.test(digits)) digits = `34${digits}`;
  if (digits.length >= 10) links.push({ label: 'Abrir en WhatsApp', href: `https://wa.me/${digits}?text=${enc(payload.texto)}` });
  return links;
}

export async function approveProposal(ctx, id, edited) {
  const { db } = ctx;
  const settings = ctx.settings();
  const p = db.proposals.get(id);
  if (!p) throw new NotFoundError('No encuentro esa propuesta.');
  if (p.status !== 'pending') throw new ValidationError('Esta propuesta ya se aprobó o se descartó.');

  // La aprobación vale para el contenido final, incluidos los cambios que haya hecho la persona.
  const merged = { ...p.payload, ...(edited && typeof edited === 'object' ? edited : {}) };
  const payload = normalizeAction({ ...merged, tipo: p.kind, agente: merged.agente }, settings.agents);
  if (!payload) throw new ValidationError('Faltan datos para poder aprobarla. Revisa los campos.');

  let result;
  switch (p.kind) {
    case 'crear_tarea': {
      const c = payload.cliente ? db.clients.findByName(payload.cliente) : null;
      const title = payload.titulo + (payload.cliente && !c ? ` (${payload.cliente})` : '');
      const t = db.tasks.create({ title, due: payload.fecha, client_id: c?.id ?? null });
      result = { message: 'Tarea creada.', taskId: t.id };
      break;
    }
    case 'crear_cliente': {
      const exists = db.clients.list().find((c) => c.name.toLowerCase() === payload.nombre.toLowerCase());
      if (exists) throw new ValidationError(`Ya tienes un cliente llamado «${exists.name}».`);
      const c = db.clients.create({ name: payload.nombre, email: payload.email, phone: payload.telefono, notes: payload.notas });
      result = { message: 'Cliente creado.', clientId: c.id };
      break;
    }
    case 'anadir_nota': {
      const c = db.clients.findByName(payload.cliente);
      if (!c) throw new ValidationError(`No encuentro al cliente «${payload.cliente}». Corrige el nombre.`);
      const line = `${new Date().toLocaleDateString('sv-SE')}: ${payload.texto}`;
      db.clients.update(c.id, { notes: c.notes ? `${c.notes}\n${line}` : line });
      result = { message: `Nota añadida a ${c.name}.`, clientId: c.id };
      break;
    }
    case 'redactar_mensaje': {
      const c = payload.cliente ? db.clients.findByName(payload.cliente) : null;
      db.audit.add('mensaje_aprobado', c?.name || payload.cliente || '', `Mensaje por ${payload.canal} listo para enviar. Lo envías tú desde tu app.`);
      result = { message: 'Aprobado. Envíalo desde tu correo o WhatsApp.', text: payload.texto, links: messageLinks(c, payload) };
      break;
    }
    case 'encargar': {
      const agent = settings.agents.find((a) => a.id === payload.agente);
      if (!agent) throw new ValidationError('Ese agente ya no está configurado.');
      const key = await ctx.secrets.get(`agent:${agent.id}`);
      const call = ctx.dispatch || dispatch;
      const out = await call(agent, key, payload.encargo, `p${id}`);
      const e = db.errands.create({ agent_id: agent.id, agent_name: agent.name, brief: payload.encargo, status: out.status });
      db.errands.update(e.id, { remote_id: out.remoteId || '', response: out.response || '' });
      db.audit.add('encargo_externo', agent.name,
        agent.kind === 'chat' ? `Encargo de ${payload.encargo.length} caracteres preparado para entregarlo a mano.` : `Encargo de ${payload.encargo.length} caracteres enviado por ${agent.kind === 'a2a' ? 'A2A' : 'webhook'}.`);
      result = {
        message: out.status === 'entregar_a_mano' ? `Encargo listo. Ábrelo en ${agent.name} y pégalo.` : out.status === 'respondido' ? `${agent.name} ya ha respondido.` : `Encargo enviado a ${agent.name}.`,
        errandId: e.id, handoff: out.handoff || null,
      };
      break;
    }
    default:
      throw new ValidationError('Tipo de propuesta desconocido.');
  }
  return db.proposals.decide(id, 'approved', payload, result);
}

export function discardProposal(ctx, id) {
  const p = ctx.db.proposals.get(id);
  if (!p) throw new NotFoundError('No encuentro esa propuesta.');
  if (p.status !== 'pending') throw new ValidationError('Esta propuesta ya se aprobó o se descartó.');
  return ctx.db.proposals.decide(id, 'discarded', p.payload, null);
}
