import {defineRemModule,remModules,type RemModuleManifest} from './rem-module-sdk.js';
import { defineCapsule, CLIENT_SUMMARY_ID, CapsuleError, type CapsuleManifest } from './capsule-sdk.js';
/** Reviewed, compiled-in modules only. A client cannot register arbitrary code. */
export class CapsuleRegistry {
  private modules = new Map<string,RemModuleManifest>();
  registerModule(raw:unknown){const m=defineRemModule(raw);if(this.modules.has(m.id)||this.definitions.has(m.id))throw new CapsuleError('CAPSULE_ID_CONFLICT');if(this.modules.size>=100)throw new CapsuleError('CAPSULE_REGISTRY_LIMIT');this.modules.set(m.id,m);}
  listModules(){return [...this.modules.values()].map(m=>structuredClone(m));}
  getModule(id:string){const m=this.modules.get(id);if(!m)throw new CapsuleError('CAPSULE_NOT_FOUND');return structuredClone(m);}
  private definitions = new Map<string, CapsuleManifest>();
  constructor(manifests: unknown[] = [clientSummaryCapsule]) { manifests.forEach(m => this.register(m));remModules.forEach(m=>this.registerModule(m)); }
  register(value: unknown): void {
    const manifest = defineCapsule(value);
    if (this.definitions.has(manifest.id)||this.modules.has(manifest.id)) throw new CapsuleError('CAPSULE_ID_CONFLICT');
    if (this.definitions.size >= 100) throw new CapsuleError('CAPSULE_REGISTRY_LIMIT');
    this.definitions.set(manifest.id, manifest);
  }
  get(id: string): CapsuleManifest {
    const value = this.definitions.get(id); if (!value) throw new CapsuleError('CAPSULE_NOT_FOUND');
    return structuredClone(value);
  }
  list(): CapsuleManifest[] { return [...this.definitions.values()].map(v => structuredClone(v)); }
}
export const clientSummaryCapsule = defineCapsule({ id: CLIENT_SUMMARY_ID, version: '1.0.0', sdkVersion: 1,
  name: 'Resumen de clientes', description: 'Contactos y próximos pasos del CRM local, en una vista de solo lectura.',
  author: 'Aulafy', license: 'MIT', renderer: 'crm.contact-summary',
  capabilities: ['database.query'], resources: ['crm.local.contacts'],
  defaults: { title: 'Mis clientes', limit: 12, relationship: 'all' } });
