// Red de seguridad: valida propuestas y detecta señales gramaticales, sin crear acciones.
export function safeAction(action, request, db) {
  const a = { ...action };
  if (a.tipo === 'crear_cliente') {
    for (const key of ['email', 'telefono']) if (a[key] && !String(request).includes(a[key])) a[key] = '';
  }
  if (a.tipo === 'anadir_nota') {
    const client = db.clients.findByName(a.cliente);
    if (!client) return null;
    a.cliente = client.name;
  }
  return a;
}

// Desempate por formas lingüísticas generales, nunca por una petición completa.
// Se limita al tramo anterior al verbo de comunicación para no interpretar
// «recuérdame» dentro del contenido de un borrador como una orden propia.
export function linguisticIntent(request) {
  const text = String(request || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const communication = /\b(?:escrib[a-z]*|prepar[a-z]*|redact[a-z]*|mand[a-z]*|envi[a-z]*|decir|di|dile|dig[a-z]*|contest[a-z]*|respond[a-z]*)\b/.exec(text);
  const prefix = communication ? text.slice(0, communication.index) : text;
  const selfReminder = /\b(?:recuerdame|recordarme|apunta(?:me)?|anota(?:me)?|pon(?:me)? (?:una |la )?tarea)\b/;
  if (selfReminder.test(prefix)) return 'tarea';
  if (!communication) return null;
  const rest = text.slice(communication.index);
  const channel = /\b(?:whatsapp|wasap|correo|email|e-mail|mail|sms|telegram|mensaje)\b/;
  const addressee = /\b(?:a|para)\s+(?!(?:hoy|manana|el|la|las|los|dentro|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b)[a-z][a-z -]*/;
  return channel.test(rest) || addressee.test(rest) ? 'mensaje' : null;
}
