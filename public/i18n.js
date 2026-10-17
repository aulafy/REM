import en from './i18n/en.json' with { type: 'json' };
import es from './i18n/es.json' with { type: 'json' };

export const catalogs = Object.freeze({ es: Object.freeze(es), en: Object.freeze(en) });
export const supportedLanguages = Object.freeze(['es', 'en']);
export const timeZone = 'Europe/Madrid';
let language = 'en';
const bindings = new Map();
const outputs = new Map();
const listeners = new Set();
export const getLanguage = () => language;
export const localeFor = value => value === 'en' ? 'en-GB' : 'es-ES';
export const validLanguage = value => supportedLanguages.includes(value);
export function detectLanguage(values = globalThis.navigator?.languages ?? [globalThis.navigator?.language]) {
  for (const value of (values ?? []).slice(0,1)) {
    const short = String(value ?? '').toLowerCase().split('-')[0];
    if (validLanguage(short)) return short;
  }
  return 'es';
}
export function translate(lang, key, ...values) {
  if (!validLanguage(lang) || !Object.hasOwn(catalogs[lang], key)) throw Error('I18N_KEY_MISSING:' + key);
  return catalogs[lang][key].replace(/⟦(\d+)⟧/g, (_match, index) => String(values[Number(index)] ?? ''));
}
export function t(key, ...values) {
  const result = translate(language, key, ...values);
  outputs.set(result, { key, values });
  if (outputs.size > 1500) outputs.delete(outputs.keys().next().value);
  return result;
}
// Use only for messages produced by the UI, never customer text, drafts or field values.
export function currentUiMessage(value) {
  const output = outputs.get(value);
  return output ? translate(language, output.key, ...output.values) : value;
}
export function localized(factory) {
  const sample = factory(), target = Array.isArray(sample) ? Array(sample.length) : {};
  return new Proxy(target, {
    get(_target, key) { return factory()[key]; },
    ownKeys() { return Reflect.ownKeys(factory()); },
    getOwnPropertyDescriptor(_target, key) {
      if (Array.isArray(target) && key === 'length') return Object.getOwnPropertyDescriptor(target, key);
      const descriptor = Object.getOwnPropertyDescriptor(factory(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}
export function bindValue(element, property, render) {
  if (!element) return;
  let properties = bindings.get(element);
  if (!properties) bindings.set(element, properties = new Map());
  properties.set(property, render);
  element[property] = render();
}
export function prependLocalized(element, render) {
  const previous = bindings.get(element)?.get('innerHTML');
  const existing = element.innerHTML;
  bindValue(element, 'innerHTML', () => render() + (previous ? previous() : existing));
}
export function onLanguageChange(callback) { listeners.add(callback); return () => listeners.delete(callback); }
function controlKey(element, root) {
  const parts = [];
  for (let node = element; node && node !== root && node.nodeType !== 9; node = node.parentElement) {
    if (node.id) { parts.unshift('#' + node.id); break; }
    const siblings = node.parentElement ? [...node.parentElement.children].filter(sibling => sibling.tagName === node.tagName) : [node];
    parts.unshift(node.tagName + ':' + siblings.indexOf(node));
  }
  return parts.join('/');
}
// Memory only. It includes unsaved fields; it is never serialized, logged, or written to settings.
export function preserveEditing(root, update) {
  if (!root?.querySelectorAll) return update();
  const controls = [...root.querySelectorAll('input,textarea,select,button')];
  const savedBindings=[...root.querySelectorAll('*')].filter(element=>bindings.has(element)).map(element=>({element,key:controlKey(element,root),properties:new Map(bindings.get(element))}));
  const saved = new Map(controls.map(element => [controlKey(element, root), {
    value: element.value, checked: element.checked, disabled: element.disabled, hidden:element.hidden,blocked:element.dataset?.blocked,
    start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection,
  }]));
  const open = new Set([...root.querySelectorAll('details[open]')].map(element => controlKey(element, root)));
  const focused = root.activeElement, focusKey = focused ? controlKey(focused, root) : null;
  const scroll = [...root.querySelectorAll('[id]')].filter(element => element.scrollTop || element.scrollLeft).map(element => [element.id, element.scrollTop, element.scrollLeft]);
  const result = update();
  // Transfer only existing UI bindings onto replacement nodes. Never reconstruct commands or controllers.
  for(const saved of savedBindings){
    if(saved.element.isConnected!==false)continue;
    const target=[...root.querySelectorAll('*')].find(element=>controlKey(element,root)===saved.key);
    if(!target)continue;
    for(const [property,render]of saved.properties)if(!bindings.get(target)?.has(property))bindValue(target,property,render);
  }
  let focusTarget;
  for (const element of root.querySelectorAll('input,textarea,select,button')) {
    const key = controlKey(element, root), old = saved.get(key);
    if (!old) continue;
    element.value = old.value; element.checked = old.checked; element.disabled = old.disabled; element.hidden=old.hidden; if(old.blocked!==undefined&&element.dataset)element.dataset.blocked=old.blocked;
    if (key === focusKey) focusTarget = element;
    if (typeof old.start === 'number' && element.setSelectionRange) {
      try { element.setSelectionRange(old.start, old.end, old.direction); } catch { /* Non-text input. */ }
    }
  }
  for (const element of root.querySelectorAll('details')) element.open = open.has(controlKey(element, root));
  if(!focusTarget&&focusKey)focusTarget=[...root.querySelectorAll('*')].find(element=>controlKey(element,root)===focusKey);
  if (!focusTarget && focused?.isConnected) focusTarget = focused;
  focusTarget?.focus?.({ preventScroll: true });
  for (const [id, top, left] of scroll) { const element = root.getElementById?.(id); if (element) { element.scrollTop = top; element.scrollLeft = left; } }
  return result;
}
export function applyStaticTranslations(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attr of ['aria-label', 'title', 'placeholder']) {
    for (const element of root.querySelectorAll(`[data-i18n-${attr}]`)) element.setAttribute(attr, t(element.getAttribute('data-i18n-' + attr)));
  }
  if (root.documentElement) root.documentElement.lang = language;
}
// Locale refresh keeps live nodes (including async handler references and native validity state).
// The bilingual catalogues retain the same element and command structure.
export function patchTranslatedHtml(element, html) {
  const doc = element?.ownerDocument;
  if (!doc?.createElement) { element.innerHTML = html; return true; }
  const template = doc.createElement('template'); template.innerHTML = html;
  const children = node => [...node.children];
  const identity = node => [...node.attributes].filter(a => a.name === 'id' || a.name === 'name' || a.name === 'type' || a.name === 'href' || (a.name.startsWith('data-') && !['data-suggest','data-blocked'].includes(a.name))).map(a => [a.name,a.value]);
  const compatible = (a,b) => {
    const left=children(a),right=children(b);
    return left.length===right.length && left.every((node,index)=>node.tagName===right[index].tagName && JSON.stringify(identity(node))===JSON.stringify(identity(right[index])) && compatible(node,right[index]));
  };
  // Do not replace a business view that changed structure while another operation is pending.
  // Its next ordinary authoritative render will use the new locale.
  if (!compatible(element,template.content)) return false;
  function patch(a,b) {
    const left=children(a),right=children(b);
    for(let i=0;i<left.length;i++) {
      const old=left[i],next=right[i];
      for(const attr of [...old.attributes])if(!next.hasAttribute(attr.name)&&!['disabled','hidden','checked','selected','value','data-blocked','aria-busy','aria-disabled','open'].includes(attr.name))old.removeAttribute(attr.name);
      for(const attr of next.attributes)if(!['disabled','hidden','checked','selected','value','data-blocked','aria-busy','aria-disabled','open'].includes(attr.name))old.setAttribute(attr.name,attr.value);
      patch(old,next);
    }
    // Reconcile only text nodes in each gap, preserving all element instances and listeners.
    const gaps=[[]];
    for(const node of b.childNodes)if(node.nodeType===1)gaps.push([]);else gaps.at(-1).push(node);
    for(let gap=0;gap<gaps.length;gap++) {
      const anchor=left[gap]??null,previous=left[gap-1]??null;
      let node=previous?previous.nextSibling:a.firstChild;
      while(node&&node!==anchor){const after=node.nextSibling;a.removeChild(node);node=after;}
      for(const next of gaps[gap])a.insertBefore(next.cloneNode(true),anchor);
    }
  }
  patch(element,template.content);return true;
}
export function setLanguage(next, { document: root = globalThis.document } = {}) {
  if (!validLanguage(next)) throw Error('I18N_LANGUAGE_INVALID');
  const result = preserveEditing(root, () => {
    language = next;
    applyStaticTranslations(root);
    for (const [element, properties] of bindings) {
      if (element.isConnected === false) { bindings.delete(element); continue; }
      for (const [property, render] of properties) { const value=render(); if(property==='innerHTML')patchTranslatedHtml(element,value);else element[property]=value; }
    }
  });
  for (const callback of listeners) callback(next);
  return result;
}
export const formatNumber = (value, options = {}) => new Intl.NumberFormat(localeFor(language), options).format(value);
export const formatMoney = (value, currency = 'EUR') => formatNumber(value, { style: 'currency', currency });
export const formatDate = (value, options = {}) => new Intl.DateTimeFormat(localeFor(language), { timeZone, ...options }).format(new Date(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00Z':value));
export function renderStaticDocument(source, lang = 'es') {
  return source.replace(/{{i18n:([\w.-]+)}}/g, (_match, key) => translate(lang,key).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))).replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);
}
