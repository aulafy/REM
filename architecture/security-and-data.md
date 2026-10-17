# Storage, recovery, and security boundaries

## Store inventory

| Store | Current location | Scope |
|---|---|---|
| Legacy business | REM data directory, `pyme1.db` | Clients, tasks, chat, proposals, pasted inbox, errands, settings, audit |
| Governed orchestration | **The same REM SQLite file** | `awos_ops`, template mappings, intakes/messages/events, business/events, follow-ups/stops |
| Credentials | Keychain on normal macOS; memory in experimental QA | Separate from business snapshots; inspect other-platform fallback before deploying |
| Runtime | Experimental `runtime/runtime.db` | Durable journal, projections, CRM, review/task/effect state |
| Capsule sidecar | `runtime.db.capsules.db` | Module configuration and audit |
| Synthetic provider sidecar | `runtime.db.fake-email.db` | Test-provider evidence |

Logical diagrams separate legacy business from orchestration for clarity, not because there are two REM databases. REM's receipt tables do not replace AWOS's authority over CRM and review/effect state.

Compatibility identifiers such as `PYME1_*`, `pyme1.db`, `Pyme1`, and `app.pyme1.local` remain from the previous name. A branding change is not a data migration. Existing installations must not be silently adopted or renamed by a development test.

## Commands and recovery

A stable command identity identifies an admitted intent. Expected revisions reject stale changes. Repeating the same command/body returns or recovers its recorded result according to the domain contract. Sending a different body with the same identity is a conflict, not a permitted overwrite.

The runtime journal and durable stores retain decisions across process termination. Replay reconstructs state without granting new external execution. A crash after an external provider may have accepted a request is qualitatively different from a request rejected before admission.

For an external effect, C6 claims/attempts and evidence determine what can happen next. `UNKNOWN` remains in observation/reconciliation until evidence resolves it; it is not changed to cancelled/failed to permit another send. `COMMITTED` evidence is retained. UI appearance never authorizes cancelling or retrying a durable effect.

The module configuration dialog freezes an unconfirmed request and reuses its identity. That buffer is in the current browser session, while registry receipts are durable in AWOS. Do not promise browser-restart persistence for the dialog buffer or call it a C6 effect.

## Copies and restoration

Normal REM backups and coordinated experimental copies have different scopes. The current `COPY_FILES` inventory in `src/awos-archive.js` contains exactly:

```text
data/pyme1.db
runtime/runtime.db
runtime/runtime.db.capsules.db
runtime/runtime.db.fake-email.db
```

Coordinated copies pause/drain relevant work, coordinate process lifecycle, create a manifest and hashes, verify the package, and restore into a separate environment. They do not overwrite the installed application. Keychain credentials are not included. A hash checks consistency; it does not provide encryption or prove that the package came from a trusted person.

A future connector inbox, attachment store, or credential backend is not automatically covered. Any new store requires inventory updates, migration/compatibility rules, interruption tests, verification, and restore tests before claiming complete recovery.

## Trust boundaries

| Boundary | Protection present | Important limit |
|---|---|---|
| Browser → REM | Loopback, Host/Origin checks, per-start token, CSP and parsing | Not a multi-user identity system or protection against same-user malware |
| REM → AI | Explicit configuration and routing policy; minimum drafting context | Partial anonymization is not complete PII removal; optional providers receive configured context |
| REM → experimental AWOS | Process token, allowlist, ownership/shape validation, temporary environment guard | Development host, no production identity/deployment guarantee |
| Module → runtime | Reviewed native registration, enumerated actions, derived capabilities, revisions | Manifest permission controls are not an OS sandbox |
| Legacy errand → external endpoint | Explicitly configured destination and approved errand | Outside the governed runtime; requires convergence before a universal effects guarantee |
| Filesystem → restore | Package selection, manifest/hash/pair verification, separate destination | No general application encryption; do not accept untrusted packages casually |

## Product hardening backlog

Before commercial deployment: reconcile legacy effects; enforce private storage permissions comprehensively; define database/backup retention and encryption; audit URLs/TLS/egress; review logs and prompt-injection paths; design identity for shared use; define revocation and connector account ownership; validate updates and signing; test migration/rollback; conduct a focused security review.

No real customer database, OAuth JSON, provider token, private evaluation output, or installer is part of the public publication. That publication hygiene is not a claim that all future runtime logs or customer inputs are automatically safe to disclose.
