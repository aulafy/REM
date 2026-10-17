import { bindValue, localized } from './i18n.js';
import { t as tx } from './i18n.js';
// Portable REM module contract. No DOM, I/O, executable imports or effect authority.
export const ACTION_ROUTES = Object.freeze({
    'intake.messages': 'intakes/messages', 'intake.preview': 'intakes/preview', 'intake.capture': 'intakes/capture', 'intake.resume': 'intakes/resume',
    'proposal.prepare': 'prepare', 'proposal.decision': 'decision', 'proposal.resume': 'resume', 'proposal.draft': 'draft', 'proposal.suggestion': 'proposal-suggestion',
    'followup.schedule': 'followups/schedule', 'followup.prepare': 'followups/prepare', 'followup.dismiss': 'followups/dismiss',
    'business.record': 'business/record', 'business.resume': 'business/resume',
});
export const MODULE_KINDS = localized(() => Object.freeze({ requests: { icon: 'tray', label: tx("module-contract.MODULE_KINDS.requests.ada2759"), group: tx("module-contract.MODULE_KINDS.capture.1900b47"), route: 'clasificar', actions: ['intake.messages', 'intake.preview', 'intake.capture', 'intake.resume'] }, proposals: { icon: 'document', label: tx("module-contract.MODULE_KINDS.proposals.834cfc1"), group: tx("module-contract.MODULE_KINDS.prepare.ee82046"), route: 'awos', actions: ['proposal.prepare', 'proposal.decision', 'proposal.resume', 'proposal.draft', 'proposal.suggestion'] }, followups: { icon: 'clock', label: tx("module-contract.MODULE_KINDS.follow_ups.d09baf6"), group: tx("module-contract.MODULE_KINDS.follow_up.7d28f80"), route: 'awos', actions: ['followup.schedule', 'followup.prepare', 'followup.dismiss', 'proposal.decision', 'proposal.resume'] }, closure: { icon: 'check', label: tx("module-contract.MODULE_KINDS.response_and_closure.06d9811"), group: tx("module-contract.MODULE_KINDS.resolve.c8f193b"), route: 'awos', actions: ['business.record', 'business.resume', 'intake.messages'] } }));
export const ACTION_CAPABILITIES = Object.freeze({ 'intake.messages': ['crm.read'], 'intake.preview': ['crm.read'], 'intake.capture': ['crm.read', 'crm.write'], 'intake.resume': ['crm.read', 'crm.write'], 'proposal.prepare': ['crm.read', 'draft.prepare', 'review.request'], 'proposal.decision': ['review.decide'], 'proposal.resume': ['crm.read', 'draft.prepare', 'review.request'], 'proposal.draft': ['crm.read', 'draft.prepare'], 'proposal.suggestion': ['draft.prepare'], 'followup.schedule': ['followup.manage'], 'followup.prepare': ['followup.manage', 'draft.prepare', 'review.request'], 'followup.dismiss': ['followup.manage'], 'business.record': ['crm.read', 'crm.write'], 'business.resume': ['crm.read', 'crm.write'] });
export const CAPABILITY_LABELS = localized(() => ({ 'crm.read': tx("module-contract.CAPABILITY_LABELS.read_your_contacts.ce3eb36"), 'crm.write': tx("module-contract.CAPABILITY_LABELS.record_crm_changes.bf142b5"), 'draft.prepare': tx("module-contract.CAPABILITY_LABELS.prepare_drafts.8740f55"), 'review.request': tx("module-contract.CAPABILITY_LABELS.create_a_review.deb03c4"), 'review.decide': tx("module-contract.CAPABILITY_LABELS.record_your_decision.db319eb"), 'followup.manage': tx("module-contract.CAPABILITY_LABELS.manage_reminders.5d2ec0e") }));
const fail = () => { throw Error('REM_MODULE_RESPONSE_INVALID'); };
const obj = v => v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v, k) => obj(v) && Object.keys(v).sort().join(',') === k.split(',').sort().join(',');
const str = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = v => str(v, 100) && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(v);
const semver = v => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
export function moduleConfig(v) {
    if (!exact(v, 'title,subtitle') || !str(v.title, 64) || !str(v.subtitle, 160))
        fail();
    return { title: v.title, subtitle: v.subtitle };
}
export function parseModuleCommand(v) {
    if (!exact(v, 'commandId,expectedRevision,sdkVersion,capsuleId,version,enabled,grants,config') || !str(v.commandId, 100) || !/^[-a-zA-Z0-9_]+$/.test(v.commandId) || !Number.isSafeInteger(v.expectedRevision) || v.expectedRevision < 0 || v.sdkVersion !== 2 || !id(v.capsuleId) || !semver(v.version) || typeof v.enabled !== 'boolean' || !Array.isArray(v.grants) || !v.grants.length || new Set(v.grants).size !== v.grants.length || v.grants.some(g => !Object.hasOwn(CAPABILITY_LABELS, g)))
        fail();
    return { commandId: v.commandId, expectedRevision: v.expectedRevision, sdkVersion: 2, capsuleId: v.capsuleId, version: v.version, enabled: v.enabled, grants: [...v.grants].sort(), config: moduleConfig(v.config) };
}
export function parseModuleCatalog(v) {
    if (!obj(v) || v.tenantId !== 'pyme1-local' || v.ownerId !== 'pyme1-owner' || !Number.isSafeInteger(v.revision) || v.revision < 0 || !Array.isArray(v.items) || v.items.length > 100 || !Array.isArray(v.audit) || v.audit.length > 30)
        fail();
    const ids = new Set(), items = v.items.map(item => {
        const m = item?.manifest;
        if (!exact(m, 'id,version,sdkVersion,name,description,author,license,renderer,kind,actions,capabilities,defaults') || !id(m.id) || ids.has(m.id) || !semver(m.version) || m.sdkVersion !== 2 || !str(m.name, 80) || !str(m.description, 500) || !str(m.author, 100) || m.license !== 'MIT' || m.renderer !== 'rem.process' || !Object.hasOwn(MODULE_KINDS, m.kind) || !Array.isArray(m.actions) || !m.actions.length || new Set(m.actions).size !== m.actions.length || m.actions.some(a => !MODULE_KINDS[m.kind].actions.includes(a)) || !Array.isArray(m.capabilities))
            fail();
        ids.add(m.id);
        const caps = [...new Set(m.actions.flatMap(a => ACTION_CAPABILITIES[a]))].sort();
        if (JSON.stringify([...m.capabilities].sort()) !== JSON.stringify(caps))
            fail();
        moduleConfig(m.defaults);
        const i = item.installation;
        if (i !== null) {
            if (!exact(i, 'id,version,sdkVersion,enabled,grants,config,updatedAt') || i.id !== m.id || !semver(i.version) || i.sdkVersion !== 2 || typeof i.enabled !== 'boolean' || !Number.isSafeInteger(i.updatedAt) || i.updatedAt < 0 || !Array.isArray(i.grants) || JSON.stringify([...i.grants].sort()) !== JSON.stringify(caps))
                fail();
            moduleConfig(i.config);
        }
        return structuredClone(item);
    });
    for (const a of v.audit)
        if (!obj(a) || typeof a.commandId !== 'string' || !id(a.capsuleId) || a.actor !== v.ownerId || !Number.isSafeInteger(a.revision) || a.revision < 1 || a.revision > v.revision || !Number.isSafeInteger(a.at) || a.at < 0 || typeof a.enabled !== 'boolean' || !semver(a.version))
            fail();
    return { ...v, items, audit: structuredClone(v.audit) };
}
export function moduleKit(item) { const m = structuredClone(item.manifest); m.id = 'custom.' + m.kind; m.author = tx("module-contract.moduleKit.your_organization.8fd3f0c"); return tx("module.export.instructions", item.manifest.name, JSON.stringify(m, null, 2)); }
export function scopedModulePath(path, moduleId) {
    if (!id(moduleId))
        fail();
    const action = Object.keys(ACTION_ROUTES).find(a => '/api/awos/' + ACTION_ROUTES[a] === path);
    return action ? '/api/awos/modules/' + encodeURIComponent(moduleId) + '/actions/' + action : path;
}
