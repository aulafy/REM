import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../src/db.js';
import { makeSecrets } from '../src/secrets.js';
import { loadSettings, saveSettings } from '../src/settings.js';
import { extractJson } from '../src/ai/json.js';
import { makeAnonymizer } from '../src/ai/anonymize.js';
import { normalizeAnswers, emulatedToAnswers, callDecision } from '../src/ai/decision.js';
import { runChat, runDecision } from '../src/ai/router.js';
import { askAgent, normalizeAction, resolveDate } from '../src/agent.js';
import { triage, TRIAGE_QUESTIONS } from '../src/triage.js';
import { approveProposal, discardProposal, messageLinks } from '../src/actions.js';
import { fromA2A, dispatch } from '../src/external-agents.js';

function ctxWith({ settings = {}, providers, secrets = {} } = {}) {
  const db = openDb(':memory:');
  saveSettings(db, settings);
  const sec = makeSecrets({ mode: 'memory' });
  for (const [k, v] of Object.entries(secrets)) sec.set(k, v);
  return { db, secrets: sec, settings: () => loadSettings(db), providers };
}

// Servidor HTTP falso para simular proveedores.
async function fakeServer(handler) {
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const out = await handler(req, body ? JSON.parse(body) : null);
    res.writeHead(out.status || 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('extractJson tolera texto alrededor y bloques de código', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Claro: {"a":{"b":"}"}} y más'), { a: { b: '}' } });
  assert.equal(extractJson('sin json'), null);
});

test('el anonimizador oculta datos personales y los recupera', () => {
  const a = makeAnonymizer(['Marta Ruiz', 'Javier Ortega']);
  const original = 'Marta Ruiz (marta@correo.es, +34 612 345 678, DNI 12345678Z) pide que Marta pague con ES91 2100 0418 4502 0005 1332.';
  const out = a.anonymize(original);
  for (const leak of ['Marta', 'marta@correo.es', '612 345 678', '12345678Z', 'ES91']) assert.ok(!out.includes(leak), `se filtra ${leak}: ${out}`);
  assert.equal(a.restore(out), original);
});

test('normalizeAnswers convierte respuestas de Jev/Clef a una forma común', () => {
  const r = normalizeAnswers({
    categoria: { type: 'choice', choice: 'cita', probabilities: { cita: 0.8, presupuesto: 0.2 }, confidence: 0.6 },
    urgencia: { type: 'score', score: 1.99, probabilities: { 2: 1 } },
    responder: { type: 'noul', noul: 0.96 },
  }, TRIAGE_QUESTIONS);
  assert.equal(r.categoria.choice, 'cita');
  assert.equal(r.urgencia.level, 2);
  assert.equal(r.urgencia.label, TRIAGE_QUESTIONS.urgencia.criteria[2]);
  assert.equal(r.responder.noul, 0.96);
});

test('la emulación con un modelo general produce la misma forma', () => {
  const r = emulatedToAnswers({ categoria: { opcion: 'presupuesto', confianza: 0.9 }, urgencia: { nivel: 1 }, responder: { probabilidad: 0.8 } }, TRIAGE_QUESTIONS);
  assert.equal(r.categoria.choice, 'presupuesto');
  assert.ok(Math.abs(Object.values(r.categoria.probabilities).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(r.urgencia.level, 1);
});

test('callDecision envía el formato System One y lee la respuesta', async () => {
  let seen;
  const srv = await fakeServer((req, body) => {
    seen = { auth: req.headers.authorization, body };
    return { body: { model: 'jev-x', answers: { categoria: { type: 'choice', choice: 'incidencia', probabilities: { incidencia: 0.9, otro: 0.1 }, confidence: 0.8 } } } };
  });
  const r = await callDecision({ kind: 'custom', url: `${srv.url}/v1/systemone`, model: 'jev-latest' }, 'k1', { state: 'x', questions: { categoria: TRIAGE_QUESTIONS.categoria } });
  srv.close();
  assert.equal(seen.auth, 'Bearer k1');
  assert.equal(seen.body.model, 'jev-latest');
  assert.equal(seen.body.questions.categoria.type, 'choice');
  assert.deepEqual(Object.keys(seen.body.questions.categoria.criteria), Object.keys(TRIAGE_QUESTIONS.categoria.criteria));
  assert.equal(r.answers.categoria.choice, 'incidencia');
});

test('modo auto: usa la IA externa si la local no responde, y anonimiza', async () => {
  let sent;
  const ctx = ctxWith({
    settings: { local: { model: 'm' }, external: { enabled: true, model: 'ext', label: 'Externa' } },
    secrets: { external: 'sk' },
    providers: {
      chatLocal: async () => { const e = new Error('x'); e.code = 'UNREACHABLE'; throw e; },
      chatExternal: async (_c, _k, req) => { sent = req; return { text: `Hola ${req.messages[0].content.match(/\[NOMBRE_1\]/)[0]}` }; },
    },
  });
  ctx.db.clients.create({ name: 'Marta Ruiz' });
  const r = await runChat(ctx, 'chat', { messages: [{ role: 'user', content: 'Escribe a Marta Ruiz' }] });
  assert.equal(r.via.target, 'external');
  assert.equal(r.via.fallback, true);
  assert.equal(r.via.anonymized, true);
  assert.ok(!sent.messages[0].content.includes('Marta'));
  assert.equal(r.text, 'Hola Marta Ruiz');
  assert.equal(ctx.db.audit.list()[0].kind, 'ia_externa');
});

test('privacidad "solo local": nunca llama a la IA externa', async () => {
  let called = false;
  const ctx = ctxWith({
    settings: { privacy: 'local-only', external: { enabled: true, model: 'ext' } },
    providers: { chatLocal: async () => ({ text: '' }), chatExternal: async () => { called = true; return { text: '' }; } },
  });
  await assert.rejects(runChat(ctx, 'chat', { prefer: 'external', messages: [{ role: 'user', content: 'hola' }] }), /privacidad/);
  assert.equal(called, false);
});

test('runDecision cae a la emulación si Jev falla', async () => {
  const ctx = ctxWith({
    settings: { decision: { kind: 'typesafe' }, local: { model: 'm' } },
    secrets: { decision: 'k' },
    providers: { chatLocal: async () => ({ text: JSON.stringify({ categoria: { opcion: 'cita', confianza: 0.7 }, urgencia: { nivel: 2 }, responder: { probabilidad: 0.9 } }) }) },
  });
  ctx.callDecision = async () => { const e = new Error('caído'); e.code = 'UNREACHABLE'; throw e; };
  const r = await runDecision(ctx, { state: 'x', questions: TRIAGE_QUESTIONS });
  assert.equal(r.via.emulated, true);
  assert.equal(r.answers.categoria.choice, 'cita');
});

test('el agente propone acciones válidas y descarta las inventadas', async () => {
  const ctx = ctxWith({
    settings: { local: { model: 'm' } },
    providers: {
      chatLocal: async (_c, req) => {
        if (req.schema?.properties.intencion) assert.doesNotMatch(JSON.stringify(req.messages), /Marta Ruiz/);
        else assert.match(req.system + JSON.stringify(req.messages), /Marta Ruiz/);
        return { text: JSON.stringify({ respuesta: 'Te propongo dos cosas.', acciones: [
          { tipo: 'crear_tarea', titulo: 'Llamar a Marta', fecha: '2026-10-12', cliente: 'Marta' },
          { tipo: 'borrar_todo' },
          { tipo: 'encargar', agente: 'nadie', encargo: 'x' },
        ] }) };
      },
    },
  });
  ctx.db.clients.create({ name: 'Marta Ruiz' });
  const r = await askAgent(ctx, '¿Qué hago con Marta?');
  assert.equal(r.proposals.length, 1);
  assert.equal(ctx.db.tasks.list().length, 0, 'no se ejecuta nada sin aprobación');
  const done = await approveProposal(ctx, r.proposals[0].id, { titulo: 'Llamar a Marta por la renovación' });
  assert.equal(done.status, 'approved');
  const t = ctx.db.tasks.list()[0];
  assert.equal(t.title, 'Llamar a Marta por la renovación');
  assert.equal(t.client_name, 'Marta Ruiz');
  await assert.rejects(approveProposal(ctx, r.proposals[0].id), /ya se aprobó/);
});

test('clasificar un mensaje propone respuesta y tarea', async () => {
  const ctx = ctxWith({
    settings: { local: { model: 'm' } },
    providers: {
      chatLocal: async (_c, req) => req.system.startsWith('Eres un clasificador')
        ? { text: JSON.stringify({ categoria: { opcion: 'presupuesto', confianza: 0.9 }, urgencia: { nivel: 1 }, responder: { probabilidad: 0.95 } }) }
        : { text: JSON.stringify({ resumen: 'Pide presupuesto de caldera.', respuesta: 'Hola, Luis: te lo preparo.', tarea: { titulo: 'Preparar presupuesto', fecha: '' } }) },
    },
  });
  ctx.db.clients.create({ name: 'Luis Marín', email: 'luis@x.es', phone: '612345678' });
  const r = await triage(ctx, { text: 'Hola, ¿me pasas presupuesto?', channel: 'correo', sender: 'luis@x.es' });
  assert.equal(r.client.name, 'Luis Marín');
  assert.equal(r.answers.categoria.choice, 'presupuesto');
  assert.deepEqual(r.proposals.map((p) => p.kind), ['redactar_mensaje', 'crear_tarea']);
  const ok = await approveProposal(ctx, r.proposals[0].id);
  assert.ok(ok.result.links.some((l) => l.href.startsWith('mailto:luis@x.es')));
  assert.ok(ok.result.links.some((l) => l.href.startsWith('https://wa.me/34612345678')));
  assert.equal(discardProposal(ctx, r.proposals[1].id).status, 'discarded');
});

test('encargos: A2A envía message/send y entiende tareas completadas', async () => {
  let rpc;
  const srv = await fakeServer((_req, body) => {
    rpc = body;
    return { body: { jsonrpc: '2.0', id: body.id, result: { kind: 'task', id: 't1', status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: 'Tres proveedores encontrados.' }] }] } } };
  });
  const out = await dispatch({ kind: 'a2a', url: srv.url, name: 'A' }, 'k', 'Busca proveedores', 'p1');
  srv.close();
  assert.equal(rpc.method, 'message/send');
  assert.equal(rpc.params.message.parts[0].text, 'Busca proveedores');
  assert.deepEqual(out, { status: 'respondido', response: 'Tres proveedores encontrados.', remoteId: 't1' });
  assert.equal(fromA2A({ kind: 'task', id: 'x', status: { state: 'working' } }).status, 'enviado');
});

test('encargos a agentes sin API (Instinct, Muse, Grok Bot) se preparan para entregar a mano', async () => {
  const ctx = ctxWith({ settings: { agents: [{ id: 'instinct', name: 'Instinct', kind: 'chat', app: 'whatsapp', handle: '+1 555 0100' }] } });
  const p = ctx.db.proposals.create('encargar', normalizeAction({ tipo: 'encargar', agente: 'Instinct', encargo: 'Reserva mesa para 4 el viernes' }, ctx.settings().agents), 'tú');
  const done = await approveProposal(ctx, p.id);
  assert.equal(ctx.db.errands.list()[0].status, 'entregar_a_mano');
  assert.ok(done.result.handoff.links[0].href.startsWith('https://wa.me/15550100?text=Reserva'));
});

test('messageLinks añade el prefijo de España a móviles de 9 cifras', () => {
  const l = messageLinks({ email: '', phone: '612 34 56 78' }, { texto: 'Hola' });
  assert.equal(l[0].href, 'https://wa.me/34612345678?text=Hola');
});

test('resolveDate entiende fechas dichas con palabras', () => {
  const sab = new Date(2026, 9, 10, 1, 30); // sábado 10/10/2026 de madrugada
  assert.equal(resolveDate('Recuérdame llamar a Pedro el martes por la mañana', sab), '2026-10-13');
  assert.equal(resolveDate('el viernes vence la factura', sab), '2026-10-16');
  assert.equal(resolveDate('mañana a primera hora', sab), '2026-10-11');
  assert.equal(resolveDate('pasado mañana', sab), '2026-10-12');
  assert.equal(resolveDate('el sábado', sab), '2026-10-17');
  assert.equal(resolveDate('el día 5', sab), '2026-11-05');
  assert.equal(resolveDate('el día 20', sab), '2026-10-20');
  assert.equal(resolveDate('llámala por la mañana', sab), '');
  assert.equal(resolveDate('el lunes o el martes', sab), '', 'si hay dos fechas, no adivina');
});

test('extracción de mensaje y fallback general conservan la tarea y el historial', async () => {
  const calls=[];
  const now=new Date(2026,9,10,12);
  const ctx=ctxWith({settings:{local:{model:'m'}},providers:{chatLocal:async(_c,req)=>{
    calls.push(req);
    if(req.system.startsWith('Eres un clasificador')) return{text:JSON.stringify({intencion:{opcion:'mensaje',confianza:.9},multiples:{probabilidad:1}})};
    if(req.schema?.properties.acciones) return{text:JSON.stringify({respuesta:'Te preparo propuestas.',acciones:[{tipo:'crear_tarea',titulo:'Cobrar factura',fecha:'2026-10-23'}]})};
    return{text:JSON.stringify({cliente:'Marta',canal:'whatsapp',asunto:'',texto:'Hola, Marta: te recuerdo que el viernes vence la factura.'})};
  }}});ctx.now=()=>now;
  const r=await askAgent(ctx,'Prepárame un WhatsApp para Marta y una tarea de cobro el viernes');
  assert.equal(calls.length,3);assert.equal(r.proposals.find(p=>p.kind==='redactar_mensaje').payload.canal,'whatsapp');
  assert.equal(r.proposals.find(p=>p.kind==='crear_tarea').payload.fecha,resolveDate('el viernes',now));
  await askAgent(ctx,'Otra petición');
  const hist=calls[4].messages.find(m=>m.role==='assistant');assert.equal(JSON.parse(hist.content).acciones.length,2);
  ctx.db.close();
});
