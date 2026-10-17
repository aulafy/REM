# Reusable REM modules

These are reviewed host/FDE entry points. They re-export existing services instead of creating another CRM, sender, scheduler, or approval queue. They are not executable uploads from an end user.

| Module | Entry | Implementation | Authority |
|---|---|---|---|
| Requests | `requests/index.js` | `src/awos-intakes.js` | Local intake receipts; AWOS contacts |
| Proposals | `proposals/index.js` | `src/awos-flow.js`, templates | Local versions/intents; AWOS review and decisions |
| Follow-ups | `followups/index.js` | `src/awos-followups.js` | Durable local scheduling; existing preparation flow; no sender |
| Response and closure | `closure/index.js` | `src/awos-business.js` | Local receipts; authoritative AWOS CRM opportunity changes |

The host supplies the database, scoped runtime client, clock, and lifecycle. Use the real exported signatures and tests. Manifests are defined by `runtime/awos/pymes/src/rem-module-sdk.ts` and registered through the existing capsule registry. Version 2 keeps version 1 compatibility, restricts actions by module type, and requires exactly the capabilities derived from those actions.

Configuration uses expected revision, a command identity, explicit confirmation, and history. Pausing denies newly admitted actions and preserves work and evidence; it does not retroactively cancel already admitted operations. Shared actions may remain available through another active module. Initial synthetic host activation happens only when an installation is absent; restart does not reactivate paused modules.

No new real sending, MCP capability, secret access, or arbitrary code is granted by a manifest. Documents and appointments remain roadmap work. See the [full FDE recipe](../architecture/modules.md).
