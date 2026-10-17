import {resolveLanguage} from './language.js';
// Clasificar un mensaje recibido (de cualquier canal) y preparar la respuesta.
import { runDecision, runJson } from './ai/router.js';
import { draftingDateReferences, unexpectedDates } from './draft-dates.js';
import { unexpectedNumbers } from './numbers.js';
import { draftingRequest } from './draft-context.js';
import { nowDate } from './clock.js';

export const TRIAGE_QUESTIONS = {
  categoria: {
    type: 'choice',
    instructions: '¿Qué tipo de mensaje es para un autónomo o una pequeña empresa?',
    criteria: {
      presupuesto: 'Pide precio, presupuesto o información para contratar',
      cita: 'Quiere quedar, llamar o cambiar una cita',
      incidencia: 'Un problema, una queja, una avería o un siniestro',
      administrativo: 'Facturas, pagos, documentos o trámites',
      informativo: 'Solo informa o agradece; no pide nada',
      otro: 'No encaja en las anteriores',
    },
  },
  urgencia: {
    type: 'score',
    instructions: '¿Con qué urgencia hay que atenderlo?',
    criteria: ['Puede esperar a la semana que viene', 'Conviene responder en uno o dos días', 'Hay que atenderlo hoy'],
  },
  responder: {
    type: 'noul',
    instructions: '¿Necesita una respuesta?',
    criteria: { true: 'Hace una pregunta o pide algo', false: 'Solo informa, no espera respuesta' },
  },
};

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    resumen: { type: 'string' },
    respuesta: { type: 'string' },
    tarea: { type: 'object', properties: { titulo: { type: 'string' }, fecha: { type: 'string' } } },
  },
  required: ['resumen', 'respuesta'],
};

const CHANNELS = { correo: 'correo', whatsapp: 'WhatsApp', telegram: 'Telegram', imessage: 'iMessage', telefono: 'teléfono', otro: 'otro canal' };

export function matchClient(clients, sender, text) {
  const s = String(sender || '').toLowerCase().trim();
  const digits = s.replace(/\D/g, '');
  return clients.find((c) => s && c.email && s.includes(c.email.toLowerCase()))
    || clients.find((c) => digits.length >= 9 && c.phone && c.phone.replace(/\D/g, '').endsWith(digits.slice(-9)))
    || clients.find((c) => s && c.name.toLowerCase() === s)
    || clients.find((c) => String(text || '').toLowerCase().includes(c.name.toLowerCase()))
    || null;
}

export async function triage(ctx, { text, channel = 'otro', sender = '', draftLanguage }) {
  const { db } = ctx;
  const settings = ctx.settings();
  const base = nowDate(ctx);
  const client = matchClient(db.clients.list(), sender, text);

  const decision = await runDecision(ctx, {
    state: { canal: CHANNELS[channel] || channel, remitente: sender || 'desconocido', mensaje: text },
    questions: TRIAGE_QUESTIONS,
  });
  const a = decision.answers;
  const needsReply = a.responder.noul >= 0.5 && a.categoria.choice !== 'informativo';

  const isolated = draftingRequest(db,text,base,{clientName:client?.name || sender,channel,language:resolveLanguage(draftLanguage,settings.language)});
  const draft = await runJson(ctx, 'draft', {
    system: `${isolated.system}
${resolveLanguage(settings.language)==='en'?'Summarize in English; write the reply in the requested draft language.':'Resume el mensaje recibido.'} Prepara la respuesta y, si el mensaje pide seguimiento, identifica la tarea con los hechos del mensaje. No asignes fechas que no estén expresadas en la petición. Devuelve resumen, respuesta y tarea según el esquema.`,
    messages: isolated.messages,
    schema: DRAFT_SCHEMA,
  });

  const d = draft.data || {};
  const summary = String(d.resumen || '').trim();
  const reply = String(d.respuesta || '').trim();
  const proposals = [];
  const who = client?.name || sender;
  if (reply && needsReply) {
    proposals.push(db.proposals.create('redactar_mensaje', {
      cliente: who, canal: channel === 'correo' ? 'correo' : channel === 'whatsapp' ? 'whatsapp' : 'otro', asunto: '', texto: reply,
      ...(settings.language||draftLanguage?{idioma:resolveLanguage(draftLanguage,settings.language)}:{}),
      avisos: unexpectedNumbers(text, { texto: reply }, draftingDateReferences(text,base).map(r=>r.date), client, { card: true }),
      avisosFecha: unexpectedDates(text,{texto:reply},base),
    }, 'clasificador'));
  }
  if (d.tarea && typeof d.tarea === 'object' && String(d.tarea.titulo || '').trim()) {
    proposals.push(db.proposals.create('crear_tarea', {
      titulo: String(d.tarea.titulo).trim().slice(0, 200),
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.tarea.fecha || '') ? d.tarea.fecha : '',
      cliente: client?.name || '',
    }, 'clasificador'));
  }

  const analysis = { answers: a, via: decision.via, draftVia: draft.via, summary, proposals: proposals.map((x) => x.id) };
  const id = db.inbox.create({ channel, sender, text, client_id: client?.id ?? null, analysis });
  return { id, client, summary, answers: a, via: decision.via, draftVia: draft.via, proposals };
}
