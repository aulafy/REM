// datetime-local represents browser-local wall time, never an ISO UTC prefix.
export function followupLocalValue(iso){
 const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';
 const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function followupInstant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Enter a valid local date and time.');
 const d=new Date(value);if(!Number.isFinite(d.getTime())||followupLocalValue(d.toISOString())!==value)throw Error('That local time does not exist or is invalid. Choose another.');return d.toISOString();
}
// Keep command identity while a response is uncertain; reading the real state
// after an error never replays the command. A deliberate retry keeps its UUID.
export function followupCommands({makeId=()=>crypto.randomUUID()}={}){
 const pending=new Map();return {input(value){const key=`${value.opId}:${value.version}`,identity=JSON.stringify(value),old=pending.get(key);if(old?.identity===identity)return old.input;const input={...value,commandId:makeId()};pending.set(key,{identity,input});return input;},confirmed(value){pending.delete(`${value.opId}:${value.version}`);}};
}
