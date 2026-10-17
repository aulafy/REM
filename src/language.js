export const validLanguage = value => value === 'es' || value === 'en';
export const resolveLanguage = (value, fallback = 'es') => validLanguage(value) ? value : validLanguage(fallback) ? fallback : 'es';
export const languageName = value => resolveLanguage(value) === 'en' ? 'English' : 'español';
export const draftLanguageInstruction = value => resolveLanguage(value) === 'en'
  ? 'Write the requested draft in English. Preserve literal facts, names and relative deadlines; never translate schema keys or claim an action was executed.'
  : 'Redacta en español. Conserva los hechos, nombres y plazos relativos literales; no traduzcas claves del esquema ni afirmes acciones ejecutadas.';
