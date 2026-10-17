// Datos ficticios para enseñar REM (demos, capturas, formación).
// Todos los nombres, correos y teléfonos son inventados (dominios .example).
import { loadSettings, saveSettings } from './settings.js';

export function hasData(db) {
  return db.clients.list().length + db.tasks.list().length + db.inbox.list(1).length > 0;
}

export function seedDemo(db) {
  // Fechas relativas a hoy, para que la demo siempre parezca de esta mañana.
  const ymd = (d) => d.toLocaleDateString('sv-SE');
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const at = (h, m, dayOffset = 0) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString(); };

  // --- Perfil ---
  const s = loadSettings(db);
  saveSettings(db, { profile: { ...s.profile, name: 'Laura Medina', business: 'Medina Seguros', sector: 'Correduría de seguros', tone: 'cercano y profesional' } });

  // --- Clientes ---
  const C = {};
  for (const c of [
    ['Javier Ortega', 'javier.ortega@correo.example', '600 100 104', 'Particular, Murcia. Auto y hogar. Prefiere que le llamen por la mañana.'],
    ['C. P. Las Palmeras', 'administracion@laspalmeras.example', '968 200 120', 'Comunidad de 24 viviendas y 2 locales. Administradora: Rosa Gil.'],
    ['Marta Ruiz', 'marta.ruiz@correo.example', '600 100 101', 'Hogar vinculado a hipoteca. Pide el certificado de estar al corriente cada año.'],
    ['Talleres Hermanos Gil', 'taller@hermanosgil.example', '968 200 133', 'Empresa, 9 empleados. Responsabilidad civil y flota de 4 vehículos. Revisar la flota en noviembre.'],
    ['Ana Torres', 'ana.torres@correo.example', '600 100 103', 'Salud y hogar. Interesada en un seguro de vida.'],
    ['Luis Marín', 'luis.marin@correo.example', '600 100 102', 'Fontanero autónomo. Furgoneta y RC profesional. Paga por transferencia.'],
    ['Clínica Dental Sonríe', 'gerencia@sonrie.example', '968 200 150', 'Clínica con 6 profesionales. RC sanitaria. Renovación en enero.'],
    ['Pablo Vega', 'pablo.vega@correo.example', '600 100 105', 'Cliente nuevo desde septiembre. Moto y hogar.'],
  ]) C[c[0]] = db.clients.create({ name: c[0], email: c[1], phone: c[2], notes: c[3] }).id;

  // --- Tareas ---
  for (const [title, due, client] of [
    ['Preparar presupuesto del edificio Las Palmeras', day(2), 'C. P. Las Palmeras'],
    ['Revisar la flota de Talleres Gil', day(5), 'Talleres Hermanos Gil'],
    ['Enviar comparativa de seguro de vida a Ana', day(1), 'Ana Torres'],
    ['Renovación de la furgoneta de Luis', day(16), 'Luis Marín'],
    ['Pedir parte del siniestro a Javier', day(0), 'Javier Ortega'],
    ['Cerrar el trimestre con la gestoría', day(8), null],
  ]) db.tasks.create({ title, due, client_id: client ? C[client] : null });
  const doneTask = db.tasks.create({ title: 'Mandar certificado a Marta', due: day(-1), client_id: C['Marta Ruiz'] });
  db.tasks.setDone(doneTask.id, true);

  // --- Propuestas ---
  const P = (kind, payload, source) => db.proposals.create(kind, payload, source);
  const pWa = P('redactar_mensaje', { cliente: 'Javier Ortega', canal: 'whatsapp', asunto: '',
    texto: 'Hola, Javier. Siento lo de la luna, menudo susto.\nTu póliza incluye la rotura de lunas sin franquicia. Te paso el teléfono de asistencia para que te la cambien sin adelantar nada.\nEn cuanto tengas el parte, me lo mandas y lo tramito.\nUn saludo, Laura.', avisos: [] }, 'clasificador');
  const pMail = P('redactar_mensaje', { cliente: 'Marta Ruiz', canal: 'correo', asunto: 'Tu certificado de estar al corriente',
    texto: 'Hola, Marta:\nTe adjunto el certificado de estar al corriente de pago de tu póliza de hogar, válido hasta el 31 de diciembre.\nCualquier cosa que necesite el banco, dímelo.\nUn saludo,\nLaura Medina', avisos: ['31'] }, 'clasificador');
  const pAna = P('redactar_mensaje', { cliente: 'Ana Torres', canal: 'whatsapp', asunto: '',
    texto: 'Hola, Ana. Sin problema: pasamos la cita al viernes a las 10:00 en la oficina. Si te viene mejor otra hora, dímelo.\nUn saludo, Laura.', avisos: [] }, 'clasificador');
  const pTask = P('crear_tarea', { titulo: 'Preparar presupuesto del edificio Las Palmeras', fecha: day(2), cliente: 'C. P. Las Palmeras' }, 'clasificador');
  db.proposals.decide(pTask.id, 'approved', pTask.payload, { message: 'Tarea añadida a tu lista' });
  const pCli = P('crear_cliente', { nombre: 'Pablo Vega', email: 'pablo.vega@correo.example', telefono: '600 100 105', notas: 'Moto y hogar.' }, 'asistente');
  db.proposals.decide(pCli.id, 'approved', pCli.payload, { message: 'Cliente creado' });
  const pOld = P('redactar_mensaje', { cliente: 'Talleres Hermanos Gil', canal: 'whatsapp', asunto: '', texto: 'Hola. Os confirmo que la póliza de responsabilidad civil ya está renovada. Os paso el recibo por correo.\nUn saludo, Laura.' }, 'asistente');
  db.proposals.decide(pOld.id, 'approved', pOld.payload, { message: 'Listo para enviar' });

  // --- Mensajes clasificados (bandeja) ---
  const A = (cat, urg, reply, probs) => ({
    categoria: { choice: cat, probabilities: probs, confidence: 0.9 },
    urgencia: { level: urg, label: ['Puede esperar', 'Uno o dos días', 'Hoy'][urg] },
    responder: { noul: reply },
  });
  const via = { target: 'local', label: 'IA local', model: 'qwen3.5:9b-mlx', emulated: true };
  for (const m of [
    ['otro', 'ofertas@prestamos-ya.example', 'Préstamos sin aval en 24 horas. Responde ya para no perder la oferta.', null, A('otro', 0, 0.05, { otro: 0.94, informativo: 0.06 }), 'Publicidad no solicitada. Archivado.', []],
    ['correo', 'luis.marin@correo.example', 'Te confirmo que ya he hecho la transferencia del recibo. Un saludo.', 'Luis Marín', A('informativo', 0, 0.1, { informativo: 0.88, administrativo: 0.12 }), 'Luis confirma que ha pagado el recibo.', []],
    ['whatsapp', '600 100 103', '¿Podemos pasar la cita del jueves al viernes por la mañana?', 'Ana Torres', A('cita', 1, 0.97, { cita: 0.95, otro: 0.05 }), 'Ana quiere mover la cita del jueves al viernes por la mañana.', [pAna.id]],
    ['correo', 'marta.ruiz@correo.example', 'Hola, Laura. Necesito el certificado de estar al corriente de pago de la póliza de hogar para el banco. ¿Me lo puedes enviar?', 'Marta Ruiz', A('administrativo', 1, 0.96, { administrativo: 0.91, informativo: 0.09 }), 'Marta necesita el certificado de estar al corriente de pago para el banco.', [pMail.id]],
    ['correo', 'administracion@laspalmeras.example', 'Buenos días. Queremos presupuesto para el seguro del edificio: 24 viviendas y 2 locales comerciales. ¿Qué documentación necesitáis?', 'C. P. Las Palmeras', A('presupuesto', 1, 0.93, { presupuesto: 0.9, administrativo: 0.1 }), 'La comunidad pide presupuesto para el seguro del edificio: 24 viviendas y 2 locales.', [pTask.id]],
    ['whatsapp', '600 100 104', 'Laura, se me ha roto la luna del coche en la autovía. ¿Me cubre el seguro? Estoy parado en el arcén.', 'Javier Ortega', A('incidencia', 2, 0.99, { incidencia: 0.96, otro: 0.04 }), 'Se le ha roto la luna del coche en la autovía. Pregunta si le cubre la póliza.', [pWa.id]],
  ]) {
    const [channel, sender, text, client, answers, summary, proposals] = m;
    db.inbox.create({ channel, sender, text, client_id: client ? C[client] : null, analysis: { answers, via, summary, proposals } });
  }

  // --- Conversación con el asistente ---
  const pChat = P('redactar_mensaje', { cliente: 'Javier Ortega', canal: 'whatsapp', asunto: '', texto: 'Hola, Javier. El perito pasará a ver el coche el miércoles por la mañana. Si no te viene bien, dímelo y lo cambiamos.\nUn saludo, Laura.', avisos: [] }, 'asistente');
  db.proposals.decide(pChat.id, 'approved', pChat.payload, { message: 'Listo para enviar', links: [{ label: 'Abrir en WhatsApp', href: 'https://wa.me/34600100104' }], text: pChat.payload.texto });
  const pChat2 = P('crear_tarea', { titulo: 'Llamar a Rosa Gil por la comunidad', fecha: day(3), cliente: 'C. P. Las Palmeras' }, 'asistente');
  const chatVia = { target: 'local', label: 'IA local', model: 'qwen3.5:9b-mlx' };
  db.chat.add('user', 'Prepárame un WhatsApp para Javier diciéndole que el perito pasa el miércoles por la mañana');
  db.chat.add('assistant', 'Te preparo el WhatsApp para Javier Ortega.', { via: chatVia, proposals: [pChat.id] });
  db.chat.add('user', 'Y recuérdame llamar a la administradora de Las Palmeras');
  db.chat.add('assistant', 'Te propongo esta tarea. En su ficha consta que la administradora es Rosa Gil.', { via: chatVia, proposals: [pChat2.id] });

  // --- Registro de lo que ha salido del Mac ---
  // En orden cronológico: la lista se muestra de más reciente a más antiguo.
  db.audit.add('encargo_externo', 'Agente de búsqueda', 'Buscar tres talleres concertados en Lorca. Sin datos de clientes.');
  db.audit.add('mensaje_aprobado', 'Talleres Hermanos Gil', 'WhatsApp aprobado por Laura y enviado desde su teléfono.');
  db.audit.add('ia_externa', 'Claude (Anthropic)', 'Comparativa de coberturas de responsabilidad civil para un taller. Se sustituyeron 3 nombres, 1 DNI y 1 IBAN antes de salir. 1.240 palabras.');

  // Fechas coherentes: hoy por la mañana para la bandeja; días anteriores para el registro.
  const inboxRows = db.all('SELECT id FROM inbox ORDER BY id DESC LIMIT 6').reverse();
  const times = [[6, 48], [7, 2], [7, 30], [7, 41], [7, 55], [8, 12]];
  inboxRows.forEach((r, i) => db.run('UPDATE inbox SET created_at = ? WHERE id = ?', at(...times[i]), r.id));
  const auditRows = db.all('SELECT id FROM audit ORDER BY id DESC LIMIT 3').reverse();
  [[9, 30, -2], [12, 5, -1], [17, 40, -1]].forEach((t, i) => auditRows[i] && db.run('UPDATE audit SET at = ? WHERE id = ?', at(...t), auditRows[i].id));
  db.run('UPDATE proposals SET decided_at = ? WHERE id = ?', at(8, 31), pTask.id);
  db.run('UPDATE proposals SET decided_at = ? WHERE id = ?', at(12, 5, -1), pOld.id);
  db.run('UPDATE proposals SET decided_at = ? WHERE id = ?', at(18, 20, -3), pCli.id);
  return { clientes: Object.keys(C).length };
}
