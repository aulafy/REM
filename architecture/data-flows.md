# Data-flow diagrams

These diagrams describe data movement and trust boundaries. They are not exhaustive call traces or proof that a future feature exists. Solid arrows describe current paths; the final diagram is explicitly a target.

## Dictionary

| ID | Entity/store | Meaning |
|---|---|---|
| E1 | Professional | Requests, pasted messages, review, explicit decisions |
| E2 | Customer | External communications currently entered manually into REM |
| E3 | Model | Authorized prompt context; untrusted proposed text or JSON |
| E4 | Communication app | Manual draft-opening links, not integrated delivery evidence |
| E5 | Legacy external agent | Configured approved errand destination |
| D1 | REM business | Legacy business records in `data/pyme1.db` |
| D2 | REM orchestration | Command/version/receipt tables in the **same file as D1** |
| D3 | Secrets | Keychain normally; memory for synthetic QA |
| D4 | Runtime | `runtime/runtime.db`: journal, projections, CRM, review/effect state |
| D5 | Sidecars | Capsules/configuration and fake-provider evidence |
| D6 | Copy package | Verified manifest and explicit SQLite inventory |

Every incoming document, message, model answer, and connector result is untrusted content. None grants an actor additional permission.

## DFD 0 — current context

```mermaid
flowchart LR
  Customer[E2 Customer] -->|message through an external app| Owner[E1 Professional]
  Owner -->|literal request, pasted content, decision| REM([P0 REM workspace])
  REM -->|draft, warning, history, actual state| Owner
  REM -->|allowed context| Model[E3 Local or configured external AI]
  Model -->|proposal without authority| REM
  REM -->|draft and opening link| App[E4 Mail / WhatsApp]
  Owner -->|manual send outside REM| App
  REM -->|approved legacy errand| Agent[E5 Configured external agent]
  Agent -->|response or status| REM
  REM -->|verified package and manifest| Files[D6 Copy files]
  Files -->|explicitly selected package| REM
```

Automatic WhatsApp/Telegram/iMessage account ingestion is not represented because it is not the current REM capability. A configured legacy agent is not a completed identity/delegation federation.

## DFD 1 — processes and authority

```mermaid
flowchart TB
  User[E1 Professional] -->|input and explicit confirmation| API([P1 Browser and local API])
  API -->|actual result or explicit error| User
  API -->|reviewable local request| Legacy([P2 Legacy assistant/actions])
  Legacy -->|proposals, tasks, notes, audit| D1[(D1 REM business)]
  D1 -->|requested context| Legacy
  Legacy -->|policy-bound context| Model[E3 Model]
  Model -->|text or JSON proposal| Legacy
  D3[(D3 Secrets)] -->|credential for configured operation| Legacy
  Legacy -->|manual draft link| App[E4 Communication app]
  Legacy -->|approved errand| Agent[E5 Legacy external agent]
  API -->|intake, prepare, decide, configure| Orchestrate([P3 REM governed orchestration])
  Orchestrate -->|command identity, mapping, receipt| D2[(D2 REM orchestration)]
  D2 -->|versions and pending intent| Orchestrate
  Orchestrate -->|bounded drafting request| Model
  Orchestrate -->|scoped command and expected revision| Runtime([P4 AWOS runtime / CRM])
  Runtime -->|review, binding, authoritative result| Orchestrate
  Runtime <-->|facts and reconstructed state| D4[(D4 Journal / projections)]
  Runtime <-->|module state and synthetic evidence| D5[(D5 Sidecars)]
  API -->|copy selection and confirmation| Copy([P5 Coordinated copy/restore])
  D1 -->|snapshot| Copy
  D2 -->|same-file snapshot| Copy
  D4 -->|coordinated snapshot| Copy
  D5 -->|included sidecars| Copy
  Copy <-->|manifest, hashes, package| D6[(D6 Copy files)]
  Copy -->|separate restored environment and result| API
```

P3 currently runs under synthetic-host restrictions and does not admit real dispatch. D1 and D2 are logical subdivisions of one SQLite. A restore creates another environment instead of overwriting the installed instance.

## DFD 2 — module configuration and lost response

```mermaid
flowchart LR
  User[Owner] -->|fields and confirmation| Intent([Freeze exact command])
  Catalog[(Read catalog and revision)] -->|version and capabilities| Intent
  Intent -->|commandId, expectedRevision, config, grants| API([Scoped API/client])
  API -->|authenticated command and session identity| Registry([Existing capsule registry])
  Registry <-->|configuration, receipt, audit| Store[(Runtime capsule store)]
  Registry -->|result or revision conflict| API
  API -->|confirmed catalog| View[Updated view]
  API -->|response unconfirmed| Pending[Keep fields locked and body unchanged]
  Pending -->|same command identity and body| API
  API -->|explicit conflict| Reload[Read again; require new confirmation]
  Reload -->|current fields; no configuration POST| User
```

The browser's pending form buffer lasts for that open dialog/session. Durable registry receipts are separate. Do not equate this UI state with a C6 external effect `UNKNOWN`.

## DFD 3 — request to closure, without real dispatch

```mermaid
flowchart LR
  User[Professional] -->|pasted message and identity choice| Intake([Capture request])
  Intake -->|provenance and idempotent contact command| CRM[(AWOS CRM)]
  CRM -->|confirmed contact/prospect| Prepare([Prepare version from template])
  Prepare -->|exact content| Review([AWOS review])
  Review -->|recipient, content, binding| User
  User -->|explicit bound decision| Decision([Durable decision])
  Decision -->|approved, not dispatched| Journal[(History / journal)]
  User -->|explicit schedule| Follow([Durable local follow-up])
  Follow -->|due: prepare another review| Review
  User -->|manual response and closure reason| Close([Record response / close])
  Close -->|interaction note and opportunity state| CRM
  Close -->|stop barrier for pending follow-ups| Follow
  Close -->|command identity and evidence| Journal
```

A scheduled follow-up is not proof of an earlier delivery. Before enabling real sending, protect the source operation across follow-up preparation, supersession, and closure races.

## Target — governed external effects and customer agents

**Future REM capability, not enabled by this snapshot.**

```mermaid
flowchart LR
  Customer[Verified customer agent / authorized channel] -. identity, message, delegated scope .-> Ingest([Connector / source validation])
  Ingest -. idempotent provenance .-> Plan([Bounded business proposal])
  Plan -. exact action/revision .-> Policy([Policy and applicable authorization])
  Policy -. authorized task .-> Runner([AWOS Governed Runner])
  Runner -. durable C6 claim / attempt .-> Journal[(Journal / evidence)]
  Runner -. external request .-> Provider[Official provider]
  Provider -. verified acceptance .-> Commit([Commit effect])
  Commit -. COMMITTED and evidence .-> Journal
  Runner -. ambiguous or lost result .-> Unknown([UNKNOWN: observe without resending])
  Unknown -. evidence lookup .-> Provider
  Provider -. evidence or unresolved absence .-> Unknown
  Unknown -. reconciled result or retained uncertainty .-> Journal
```

Incoming text cannot authorize an operation. Delegated agent interactions need verified identity, revocation, bounded scope, consent, audit, and human escalation. UNKNOWN cannot be relabeled to obtain another send attempt.
