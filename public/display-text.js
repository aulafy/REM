// Presentation-only aliases for built-in legacy copy. Never rewrites stored data or model output.
const builtins = Object.freeze({
"La dirección de la IA local no es válida.":"The local AI address is invalid.","Tipo de IA externa no válido.":"Invalid external AI type.","La dirección de la IA externa no es válida.":"The external AI address is invalid.","Tipo de modelo de decisión no válido.":"Invalid decision model type.","Indica la dirección del modelo de decisión.":"Enter a decision model address.","Modo de uso de IA no válido.":"Invalid AI routing mode.","Opción de privacidad no válida.":"Invalid privacy option.","Lista de agentes no válida.":"Invalid agent list.","Tipo de agente no válido.":"Invalid agent type.","Las copias no están disponibles en este servidor.":"Backups are unavailable on this server.","Identificador de plantilla no válido.":"Invalid template identifier.","No encuentro esa versión de la plantilla.":"Template version not found.","No encuentro esa plantilla.":"Template not found.","Ya tienes datos. Los datos de ejemplo se añadirían a los tuyos; confirma si quieres hacerlo igualmente.":"This workspace already has data. Sample records would be added alongside it; confirm only if you intend this.","El cierre no está disponible en este servidor.":"Shutdown is unavailable on this server.","REM se está cerrando.":"REM is shutting down.","Escribe algo para el asistente.":"Enter a message for your assistant.","El mensaje es demasiado largo.":"The message is too long.","Pega el mensaje que quieres clasificar.":"Paste a message to classify.","El cliente necesita un nombre.":"Enter a client name.","No encuentro ese cliente.":"Client not found.","Escribe la tarea.":"Enter a task.","Elige un agente.":"Choose an agent.","Escribe el encargo.":"Enter an errand.","No encuentro ese encargo.":"Errand not found.","Ese agente ya no está configurado.":"That agent is no longer configured.","Nombre de clave no válido.":"Invalid credential name.","Elige primero un modelo de decisión.":"Choose a decision model first.","No encuentro ese agente.":"Agent not found.","La petición es demasiado grande.":"The request is too large.","La petición no es JSON válido.":"The request is not valid JSON.","La carpeta de datos ha cambiado. Reinicia REM.":"The data folder changed. Restart REM.","La carpeta de copias no puede ser un enlace.":"The backup folder cannot be a symbolic link.","La copia existente no puede ser un enlace.":"An existing backup cannot be a symbolic link.","Solo se pueden mostrar copias de REM dentro de su carpeta de datos.":"Only REM backups inside the data directory can be revealed.","La copia no existe.":"The backup does not exist.","La ruta de la copia no es válida.":"Invalid backup path.",

  'Solicitudes': 'Requests', 'Propuestas': 'Proposals', 'Seguimientos': 'Follow-ups',
  'Respuestas y cierre': 'Response and closure',
  'Cada conversación, un siguiente paso.': 'A clear next step for every conversation.',
  'De una buena idea a una propuesta clara.': 'From a good idea to a clear proposal.',
  'Que ninguna oportunidad se quede atrás.': 'Keep every opportunity moving.',
  'Una historia completa para cada oportunidad.': 'A complete history for every opportunity.',
  'Abrir en Mail': 'Open in Mail', 'Abrir en WhatsApp': 'Open in WhatsApp',
  'Tarea creada.': 'Task created.', 'Cliente creado.': 'Client created.',
  'Aprobado. Envíalo desde tu correo o WhatsApp.': 'Draft saved. Send it manually from Mail or WhatsApp.',
  'OpenRouter (muchos modelos)': 'OpenRouter (multiple models)',
  'Otro compatible con OpenAI': 'Other OpenAI-compatible provider',
  'memoria': 'memory', 'archivo local protegido': 'local file with restricted permissions', 'Llavero de macOS': 'macOS Keychain', 'memoria (solo pruebas)': 'memory (testing only)',
  'Host no permitido.': 'Host not allowed.', 'Origen no permitido.': 'Origin not allowed.',
  'Sesión no válida. Vuelve a abrir la app.': 'Invalid session. Open the app again.',
  'Ruta desconocida.': 'Unknown route.',
  'Ha ocurrido un error interno. Revisa la consola.': 'An internal error occurred. Check the server console.',
  'Esta copia solo incluye REM. El correo experimental necesita una copia conjunta con AWOS.': 'This copy includes REM only. Experimental email needs a coordinated AWOS copy.',
});
export const displayText = value => Object.hasOwn(builtins, value) ? builtins[value] : value;
