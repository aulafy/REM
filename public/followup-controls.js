import { t as tx } from './i18n.js';
// datetime-local is interpreted in the business zone, independently of the host/browser zone.
const madridParts = iso => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date(iso)).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
export function followupLocalValue(iso) {
    if (!Number.isFinite(new Date(iso).getTime())) return '';
    const p = madridParts(iso);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function followupInstant(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
        throw Error(tx("followup-controls.followupInstant.enter_a_valid_local_date.ce5eb0d"));
    const wall = Date.parse(value + ':00Z'), candidates = new Set();
    if (Number.isFinite(wall)) for (const delta of [-2, 0, 2]) {
        const sample = wall + delta * 86400000, p = madridParts(sample);
        const offset = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - sample;
        const instant = wall - offset;
        if (followupLocalValue(instant) === value) candidates.add(instant);
    }
    if (!candidates.size) throw Error(tx("followup-controls.followupInstant.that_local_time_does_not.b407565"));
    // On the repeated autumn hour, choose the first occurrence, as the previous local Date parser did.
    return new Date(Math.min(...candidates)).toISOString();
}
// Keep command identity while a response is uncertain; reading the real state
// after an error never replays the command. A deliberate retry keeps its UUID.
export function followupCommands({ makeId = () => crypto.randomUUID() } = {}) {
    const pending = new Map();
    return { input(value) {
            const key = `${value.opId}:${value.version}`, identity = JSON.stringify(value), old = pending.get(key);
            if (old?.identity === identity)
                return old.input;
            const input = { ...value, commandId: makeId() };
            pending.set(key, { identity, input });
            return input;
        }, confirmed(value) { pending.delete(`${value.opId}:${value.version}`); } };
}
