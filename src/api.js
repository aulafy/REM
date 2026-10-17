import {ACTION_ROUTES} from '../public/module-contract.js';
// API local de la app. Solo escucha en 127.0.0.1 y exige el token de la sesión en cada llamada.
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { loadSettings, saveSettings, ValidationError, EXTERNAL_PRESETS } from './settings.js';
import { listModels, ping, AiError } from './ai/providers.js';
import { callDecision, DECISION_PROVIDERS } from './ai/decision.js';
import { askAgent } from './agent.js';
import { triage, TRIAGE_QUESTIONS } from './triage.js';
import { approveProposal, discardProposal, NotFoundError } from './actions.js';
import { refresh, testAgent, AGENT_PRESETS } from './external-agents.js';
import { seedDemo, hasData } from './demo.js';
import { AwosError } from './awos-client.js';
import {renderProposal} from './proposal-templates.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function createApp({ db, secrets, token, staticDir, getPort, onShutdown, instanceId, backups, awos, copies, maintenance, overrides = {} }) {
  const ctx = { db, secrets, settings: () => loadSettings(db), ...overrides };

  async function publicSettings() {
    const s = ctx.settings();
    const has = async (n) => !!(await secrets.get(n));
    return {
      ...s,
      keys: {
        external: await has('external'),
        decision: await has('decision'),
        agents: Object.fromEntries(await Promise.all(s.agents.map(async (a) => [a.id, await has(`agent:${a.id}`)]))),
      },
      secretsWhere: secrets.where,
    };
  }

  function backupManager() {
    if (!backups) throw new ValidationError('Las copias no están disponibles en este servidor.');
    return backups;
  }
  const backupScope = value => awos ? {...value, scope: 'pyme1-only', notice: 'Esta copia solo incluye REM. El correo experimental necesita una copia conjunta con AWOS.'} : value;
  const templateError=e=>{if(e?.code==='PROPOSAL_TEMPLATE_INVALID')throw new ValidationError(e.message);throw e;};
  const templateId=v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v||'')?v:(()=>{throw new ValidationError('Identificador de plantilla no válido.');})();
  function renderedProposal(body){try{const id=templateId(body?.templateId),version=Number(body?.templateVersion),template=db.proposalTemplates.get(id,version);if(!template)throw new NotFoundError('No encuentro esa versión de la plantilla.');const rendered=renderProposal(template,body.variables);return {template,rendered};}catch(e){return templateError(e);}}
  const routes = [
    ['GET', /^\/api\/awos\/modules$/,async()=>{if(!awos?.modules)return {enabled:false};if(!awos.host.ready())throw new AwosError('AWOS_UNAVAILABLE',503);return {enabled:true,...await awos.modules.catalog()};}],
    ['POST', /^\/api\/awos\/modules\/configure$/,async b=>{if(!awos?.modules)throw new AwosError('AWOS_DISABLED',404);return {enabled:true,...await awos.modules.configure(b)};}],
    ['POST', /^\/api\/awos\/modules\/([a-z0-9.-]+)\/actions\/([a-z.]+)$/,async(b,m)=>{if(!awos?.modules)throw new AwosError('AWOS_DISABLED',404);await awos.modules.authorize(m[1],m[2]);const path='/api/awos/'+ACTION_ROUTES[m[2]],target=routes.find(([method,re])=>method==='POST'&&re.test(path));if(!target)throw new AwosError('REM_MODULE_ACTION_DENIED',403);return target[2](b,path.match(target[1]));}],
    ['GET', /^\/api\/awos\/intakes$/, async()=>{if(!awos?.intakes)return {enabled:false};if(!awos.host.ready())throw new AwosError('AWOS_UNAVAILABLE',503);return {enabled:true,synthetic:true,messages:db.inbox.list(100),intakes:awos.intakes.list(),contacts:await awos.flow.contacts()};}],
    ['POST', /^\/api\/awos\/intakes\/(messages|preview|capture|resume)$/,async(b,m)=>{if(!awos?.intakes)throw new AwosError('AWOS_DISABLED',404);if(!awos.host.ready())throw new AwosError('AWOS_UNAVAILABLE',503);if(m[1]==='messages')return awos.intakes.paste(b);if(m[1]==='preview')return awos.intakes.preview(b);if(m[1]==='capture')return awos.intakes.capture(b);if(!b||Object.keys(b).join(',')!=='commandId')throw new AwosError('AWOS_INTAKE_INPUT_INVALID',400);return awos.intakes.resume(b.commandId);}],
    ['GET', /^\/api\/awos\/copies$/, async()=>copies?copies.status():{enabled:false},true],
    ['POST', /^\/api\/awos\/copies\/(create|import|restore|open|resume)$/, async(b,m)=>{if(!copies)throw new AwosError('AWOS_COPY_DISABLED',404);return copies.request(m[1],b);},true],
    ['POST', /^\/api\/awos\/copies\/retry$/, async b=>{if(!copies)throw new AwosError('AWOS_COPY_DISABLED',404);if(!b||Object.keys(b).join(',')!=='requestId')throw new AwosError('AWOS_COPY_INPUT_INVALID',400);return copies.retry(b.requestId);},true],
    ['POST', /^\/api\/awos\/copies\/reveal$/, async b=>{if(!copies)throw new AwosError('AWOS_COPY_DISABLED',404);if(!b||Object.keys(b).join(',')!=='copyId')throw new AwosError('AWOS_COPY_INPUT_INVALID',400);return copies.reveal(b.copyId);},true],
    ['GET', /^\/api\/awos$/, async () => {
      if (!awos) return {enabled:false};
      if (!awos.host.ready()) throw new AwosError('AWOS_UNAVAILABLE',503);
      const operations=await awos.flow.list();
      return {enabled:true,synthetic:true,planner:awos.planner,contacts:await awos.flow.contacts(),templates:db.proposalTemplates.list(),operations,business:awos.business?await awos.business.list(operations):null,followups:awos.followups?.list()??[],defaultFollowupDue:awos.followups?.defaultDue()};
    }],
    ['POST', /^\/api\/awos\/business\/(record|resume)$/,async(b,m)=>{if(!awos?.business)throw new AwosError('AWOS_DISABLED',404);if(!awos.host.ready())throw new AwosError('AWOS_UNAVAILABLE',503);if(m[1]==='record')return awos.business.record(b);if(!b||Object.keys(b).join(',')!=='commandId')throw new AwosError('AWOS_BUSINESS_INPUT_INVALID',400);return awos.business.resume(b.commandId);}],
    ['POST', /^\/api\/awos\/followups\/(schedule|prepare|dismiss|tick)$/, async(b,m)=>{
      if(!awos?.followups)throw new AwosError('AWOS_DISABLED',404);if(!awos.host.ready())throw new AwosError('AWOS_UNAVAILABLE',503);
      if(m[1]==='schedule')return awos.followups.schedule(b);if(m[1]==='prepare')return awos.followups.prepare(b.id);if(m[1]==='dismiss')return awos.followups.dismiss(b.id,b.reason);
      if(m[1]==='tick')throw new AwosError('AWOS_OPERATION_DISABLED',403);
    }],
    ['POST', /^\/api\/awos\/(prepare|resume|decision|draft|proposal-suggestion)$/, async (b,m) => {
      if (!awos) throw new AwosError('AWOS_DISABLED',404);
      if (!awos.host.ready()) throw new AwosError('AWOS_UNAVAILABLE',503);
      if(m[1]==='prepare'){
       if(!b.proposal)return awos.flow.prepare(b);
       const {template,rendered}=renderedProposal(b.proposal);
       return awos.flow.prepare({...b,subject:rendered.subject,body:rendered.body,template:{templateId:template.id,templateVersion:template.version,variables:rendered.variables}});
      }
      if(m[1]==='resume')return awos.flow.resume(b.opId,b.version);
      if(m[1]==='decision')return awos.flow.decide(b.opId,b.version,{commandId:b.commandId,bindingHash:b.bindingHash,decision:b.decision});
      if(m[1]==='proposal-suggestion'){try{return await awos.suggest(ctx.settings(),{kind:b.kind,cliente:b.cliente,servicio:b.servicio});}catch(e){if(/^AWOS_[A-Z_]+$/.test(e.message))throw new AwosError(e.message,400);throw e;}}
      const c=(await awos.flow.contacts()).find(c=>c.id===b.contactId);
      if(!c||typeof b.request!=='string'||!b.request.trim()||b.request.length>8000)throw new AwosError('AWOS_INPUT_INVALID',400);
      try{return await awos.draft(ctx.settings(),c,b.request);}catch(e){if(/^AWOS_[A-Z_]+$/.test(e.message))throw new AwosError(e.message,400);throw e;}
    }],
    ['GET', /^\/api\/proposal-templates$/, async()=>db.proposalTemplates.list()],
    ['GET', /^\/api\/proposal-templates\/([a-f0-9-]{36})$/, async(_b,m)=>{const rows=db.proposalTemplates.history(m[1]);if(!rows.length)throw new NotFoundError('No encuentro esa plantilla.');return rows;}],
    ['POST', /^\/api\/proposal-templates$/, async b=>{try{return db.proposalTemplates.create(b);}catch(e){return templateError(e);}}],
    ['PUT', /^\/api\/proposal-templates\/([a-f0-9-]{36})$/, async(b,m)=>{try{const out=db.proposalTemplates.update(m[1],b);if(!out)throw new NotFoundError('No encuentro esa plantilla.');return out;}catch(e){return templateError(e);}}],
    ['DELETE', /^\/api\/proposal-templates\/([a-f0-9-]{36})$/, async(_b,m)=>({ok:db.proposalTemplates.remove(m[1])})],
    ['POST', /^\/api\/proposal-templates\/render$/, async b=>{const {template,rendered}=renderedProposal(b);return {templateId:template.id,templateVersion:template.version,...rendered};}],
    ['GET', /^\/api\/backups$/, async () => backupScope(backupManager().status())],
    ['POST', /^\/api\/backups$/, async () => backupScope(backupManager().create())],
    ['POST', /^\/api\/demo$/, async (b) => {
      if (hasData(db) && b.forzar !== true) throw new ValidationError('Ya tienes datos. Los datos de ejemplo se añadirían a los tuyos; confirma si quieres hacerlo igualmente.');
      if (backups) { try { backups.create(); } catch { /* La demo no depende de la copia. */ } }
      return { ok: true, ...seedDemo(db) };
    }],
    ['POST', /^\/api\/backups\/reveal$/, async (body) => backupManager().show(body.path)],
    ['POST', /^\/api\/shutdown$/, async () => {
      if (!onShutdown) throw new ValidationError('El cierre no está disponible en este servidor.');
      return { ok: true, message: 'REM se está cerrando.' };
    }],
    ['GET', /^\/api\/state$/, async () => {
      const chat = db.chat.list(60);
      const chatProposals = {};
      for (const m of chat) for (const pid of m.meta?.proposals || []) { const p = db.proposals.get(pid); if (p) chatProposals[pid] = p; }
      const inbox = db.inbox.list(20);
      // Estado de lo preparado para cada mensaje, aunque sea antiguo.
      for (const m of inbox) for (const pid of m.analysis?.proposals || []) { if (!chatProposals[pid]) { const p = db.proposals.get(pid); if (p) chatProposals[pid] = p; } }
      return {
        settings: await publicSettings(),
        presets: { external: EXTERNAL_PRESETS, decision: DECISION_PROVIDERS, agents: AGENT_PRESETS },
        clients: db.clients.list(),
        tasks: db.tasks.list(),
        pending: db.proposals.pending(),
        recent: db.proposals.recent(15),
        errands: db.errands.list(),
        inbox,
        chat,
        chatProposals,
        awosIntakesEnabled: !!awos?.intakes,
        awosFollowups: awos?.followups?.list().filter(f=>f.state==='due')??[],
      };
    }],
    ['POST', /^\/api\/chat$/, async (b) => {
      const text = String(b.text || '').trim();
      if (!text) throw new ValidationError('Escribe algo para el asistente.');
      if (text.length > 8000) throw new ValidationError('El mensaje es demasiado largo.');
      return askAgent(ctx, text, { prefer: ['local', 'external'].includes(b.prefer) ? b.prefer : undefined });
    }],
    ['POST', /^\/api\/chat\/clear$/, async () => { db.chat.clear(); return { ok: true }; }],
    ['POST', /^\/api\/triage$/, async (b) => {
      const text = String(b.text || '').trim();
      if (!text) throw new ValidationError('Pega el mensaje que quieres clasificar.');
      if (text.length > 12000) throw new ValidationError('El mensaje es demasiado largo.');
      return triage(ctx, { text, channel: String(b.channel || 'otro'), sender: String(b.sender || '').slice(0, 200) });
    }],
    ['POST', /^\/api\/proposals\/(\d+)\/approve$/, async (b, m) => approveProposal(ctx, Number(m[1]), b.payload)],
    ['POST', /^\/api\/proposals\/(\d+)\/discard$/, async (_b, m) => discardProposal(ctx, Number(m[1]))],

    ['POST', /^\/api\/clients$/, async (b) => {
      if (!String(b.name || '').trim()) throw new ValidationError('El cliente necesita un nombre.');
      return db.clients.create({ name: String(b.name).slice(0, 120), email: String(b.email || '').slice(0, 200), phone: String(b.phone || '').slice(0, 40), notes: String(b.notes || '').slice(0, 5000) });
    }],
    ['PUT', /^\/api\/clients\/(\d+)$/, async (b, m) => {
      const c = db.clients.update(Number(m[1]), {
        name: b.name !== undefined ? String(b.name).slice(0, 120) : undefined,
        email: b.email !== undefined ? String(b.email).slice(0, 200) : undefined,
        phone: b.phone !== undefined ? String(b.phone).slice(0, 40) : undefined,
        notes: b.notes !== undefined ? String(b.notes).slice(0, 5000) : undefined,
      });
      if (!c) throw new NotFoundError('No encuentro ese cliente.');
      return c;
    }],
    ['DELETE', /^\/api\/clients\/(\d+)$/, async (_b, m) => ({ ok: db.clients.remove(Number(m[1])) })],
    ['POST', /^\/api\/tasks$/, async (b) => {
      if (!String(b.title || '').trim()) throw new ValidationError('Escribe la tarea.');
      return db.tasks.create({ title: String(b.title).slice(0, 200), due: /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : '', client_id: b.client_id ? Number(b.client_id) : null });
    }],
    ['PUT', /^\/api\/tasks\/(\d+)$/, async (b, m) => ({ ok: db.tasks.setDone(Number(m[1]), !!b.done) })],
    ['DELETE', /^\/api\/tasks\/(\d+)$/, async (_b, m) => ({ ok: db.tasks.remove(Number(m[1])) })],

    ['POST', /^\/api\/errands$/, async (b) => {
      const s = ctx.settings();
      const agent = s.agents.find((a) => a.id === b.agent);
      if (!agent) throw new ValidationError('Elige un agente.');
      const brief = String(b.brief || '').trim();
      if (!brief) throw new ValidationError('Escribe el encargo.');
      return db.proposals.create('encargar', { agente: agent.id, agente_nombre: agent.name, encargo: brief.slice(0, 6000) }, 'tú');
    }],
    ['POST', /^\/api\/errands\/(\d+)\/refresh$/, async (_b, m) => {
      const e = db.errands.get(Number(m[1]));
      if (!e) throw new NotFoundError('No encuentro ese encargo.');
      const agent = ctx.settings().agents.find((a) => a.id === e.agent_id);
      if (!agent) throw new ValidationError('Ese agente ya no está configurado.');
      const out = await refresh(agent, await secrets.get(`agent:${agent.id}`), e.remote_id);
      return out ? db.errands.update(e.id, { status: out.status, response: out.response || e.response }) : e;
    }],
    ['POST', /^\/api\/errands\/(\d+)\/response$/, async (b, m) => {
      const e = db.errands.update(Number(m[1]), { status: b.close ? 'cerrado' : 'respondido', response: String(b.response ?? '').slice(0, 20000) });
      if (!e) throw new NotFoundError('No encuentro ese encargo.');
      return e;
    }],

    ['GET', /^\/api\/audit$/, async () => db.audit.list(200)],
    ['POST', /^\/api\/settings$/, async (b) => { saveSettings(db, b || {}); return publicSettings(); }],
    ['POST', /^\/api\/secrets$/, async (b) => {
      const name = String(b.name || '');
      if (!/^(external|decision|agent:[\w-]+)$/.test(name)) throw new ValidationError('Nombre de clave no válido.');
      await secrets.set(name, String(b.value || '').trim());
      db.audit.add('clave', name, b.value ? 'Clave guardada.' : 'Clave eliminada.');
      return publicSettings();
    }],
    ['GET', /^\/api\/models\/(local|external)$/, async (_b, m) => {
      const s = ctx.settings();
      return listModels(m[1], m[1] === 'local' ? s.local : s.external, m[1] === 'external' ? await secrets.get('external') : '');
    }],
    ['POST', /^\/api\/test\/(local|external|decision)$/, async (_b, m) => {
      const s = ctx.settings();
      if (m[1] === 'decision') {
        if (s.decision.kind === 'none') throw new ValidationError('Elige primero un modelo de decisión.');
        const started = Date.now();
        const r = await (ctx.callDecision || callDecision)(s.decision, await secrets.get('decision'), {
          state: 'Hola, ¿me podéis pasar presupuesto para cambiar la caldera?',
          questions: { categoria: TRIAGE_QUESTIONS.categoria },
        });
        return { ok: true, ms: Date.now() - started, sample: `${r.answers.categoria.choice} (${Math.round(r.answers.categoria.probabilities[r.answers.categoria.choice] * 100)} %)` };
      }
      return ping(m[1], m[1] === 'local' ? s.local : s.external, m[1] === 'external' ? await secrets.get('external') : '');
    }],
    ['POST', /^\/api\/test\/agent\/([\w-]+)$/, async (_b, m) => {
      const agent = ctx.settings().agents.find((a) => a.id === m[1]);
      if (!agent) throw new NotFoundError('No encuentro ese agente.');
      return testAgent(agent, await secrets.get(`agent:${agent.id}`));
    }],
  ];

  function send(res, status, body, headers = {}) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': isJson ? 'application/json; charset=utf-8' : headers['content-type'], ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 1_000_000) throw new ValidationError('La petición es demasiado grande.'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ValidationError('La petición no es JSON válido.'); }
  }

  return async function handler(req, res) {
    try {
      // Protección frente a "DNS rebinding": solo se acepta el host local exacto.
      const port = getPort();
      const host = String(req.headers.host || '');
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, { error: 'HOST', message: 'Host no permitido.' });
      const url = new URL(req.url, `http://${host}`);

      if (url.pathname.startsWith('/api/')) {
        if (!safeEq(req.headers['x-pyme1-token'] || '', token)) return send(res, 401, { error: 'TOKEN', message: 'Sesión no válida. Vuelve a abrir la app.' });
        const origin = req.headers.origin;
        if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'ORIGIN', message: 'Origen no permitido.' });
        for (const [method, re, fn, control] of routes) {
          const m = url.pathname.match(re);
          if (m && req.method === method) {
            const body = method === 'GET' ? {} : await readBody(req);
            const release=!control?maintenance?.enter():undefined;
            let output;try{if(awos?.modules&&req.method==='POST'){const action=Object.keys(ACTION_ROUTES).find(a=>'/api/awos/'+ACTION_ROUTES[a]===url.pathname);if(action)await awos.modules.forAction(action);}output=await fn(body,m);}finally{release?.();}
            if (url.pathname === '/api/shutdown') res.once('finish', () => setImmediate(onShutdown));
            return send(res, 200, output);
          }
        }
        return send(res, 404, { error: 'NOT_FOUND', message: 'Ruta desconocida.' });
      }

      if (req.method !== 'GET') return send(res, 405, 'Método no permitido', { 'content-type': 'text/plain; charset=utf-8' });
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^[\w.-]+$/.test(file) || !MIME[extname(file)]) return send(res, 404, 'No encontrado', { 'content-type': 'text/plain; charset=utf-8' });
      let content = await readFile(join(staticDir, file)).catch(() => null);
      if (!content) return send(res, 404, 'No encontrado', { 'content-type': 'text/plain; charset=utf-8' });
      if (file === 'index.html') content = content.toString('utf8').replace('__PYME1_TOKEN__', token);
      return send(res, 200, content, { 'content-type': MIME[extname(file)], 'content-security-policy': CSP, ...(file === 'index.html' && instanceId ? { 'x-pyme1-instance': instanceId } : {}) });
    } catch (e) {
      const status = e instanceof AwosError ? e.status : e instanceof ValidationError ? 400 : e instanceof NotFoundError ? 404 : e instanceof AiError ? (e.code === 'NOT_CONFIGURED' ? 400 : 502) : 500;
      if (status === 500) console.error('Error interno:', e);
      return send(res, status, { error: e.code || 'INTERNAL', message: status === 500 ? 'Ha ocurrido un error interno. Revisa la consola.' : e.message });
    }
  };
}
