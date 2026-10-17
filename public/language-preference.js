import {detectLanguage,getLanguage,setLanguage,validLanguage} from './i18n.js';
// Settings only. No model call, workflow command, approval or dispatch.
export function createLanguagePreference({readSettings,writeSettings,save,apply=setLanguage,languages}) {
  let pending = false;
  async function choose(next) {
    if (!validLanguage(next)) throw Error('I18N_LANGUAGE_INVALID');
    if (pending) throw Error('I18N_SAVE_PENDING');
    const previous = getLanguage(); pending = true; apply(next);
    try { const settings = await save({language:next}); if(settings.language!==next)throw Error('I18N_SAVE_UNCONFIRMED');writeSettings(settings);return settings; }
    catch(error) { apply(previous); throw error; }
    finally { pending = false; }
  }
  async function initialize() {
    const saved = readSettings().language;
    if(validLanguage(saved)){apply(saved);return saved;}
    const next = detectLanguage(languages);apply(next);
    await choose(next);return next;
  }
  return {initialize,choose,get pending(){return pending;}};
}
