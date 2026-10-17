# Reusable modules and the FDE contract

## What a module is

A REM module packages a business capability around reviewed source, an explicit domain contract, a scoped UI, and the shared runtime. It is not arbitrary code submitted by a user, a new autonomous agent with unlimited tools, or a second authoritative database.

An FDE adapts a module to the professional's actual process. A user may use Claude, Codex, or another development tool to propose a change, but the resulting code still needs review, tests, and permission analysis before registration.

## Current module surfaces

| Module ID | Reusable entry | State owned locally | Shared authority |
|---|---|---|---|
| `rem.requests` | `modules/requests/index.js` | Intake, provenance, command receipts, identity resolution intent | AWOS contacts and prospect context |
| `rem.proposals` | `modules/proposals/index.js` | Operation/version mapping, template versions, preparation/decision intent | AWOS tasks, draft/review binding, decisions |
| `rem.followups` | `modules/followups/index.js` | Durable schedule, due/prepared state, stop barriers | Existing proposal workflow and AWOS state |
| `rem.closure` | `modules/closure/index.js` | Response/closure command receipts and recovery progress | AWOS notes, opportunity status, preserved workflow history |

The entry files re-export implementations from `src/`; there is no duplicated service layer. The host supplies database, runtime client, clock, and lifecycle. Tests demonstrate actual function signatures and error behavior.

## Manifest and registration

The version 2 SDK lives in `runtime/awos/pymes/src/rem-module-sdk.ts`; `CapsuleRegistry` owns registration, installation/configuration, and audit. Read its exported types rather than inventing another manifest shape. Version 1 contact-summary capsules remain compatible.

A reviewed version 2 manifest declares identity/version, a recognized module type, allowed enumerated actions, exactly derived capabilities, and bounded default configuration. A native reviewed registration connects it to existing handlers. The browser cannot import new executable JavaScript or register unreviewed code through a general HTTP endpoint.

The library can edit a title/subtitle and availability; proposal templates have their separate versioned business surface. The downloadable contract is an implementation starting point, not a one-click installer or an unconstrained workflow builder.

## Configuration lifecycle

1. Read the authoritative catalog and revision.
2. Show current configuration, capabilities, and history.
3. Collect explicit confirmation.
4. Freeze a command identity, expected revision, configuration, and grants.
5. Send through the bounded API/runtime client.
6. Publish confirmed state only after an authoritative result.
7. If the response is lost, keep the request unchanged and retry the same command.
8. If the server reports a revision conflict, read again and ask for a fresh confirmation.

Pausing prevents new calls admitted through that module, preserves clients/work/history, and does not cancel requests already admitted. An action shared by another active module can still be available through that module. Restart preserves paused installations; synthetic first-launch bootstrapping only creates absent installations.

## Build a new module

### 1. Describe the business problem

Write who uses it, what triggers it, what result is useful, what information is minimally necessary, and which decision belongs to the professional. Example: a document checklist needs requirement labels and received/pending status; it does not initially need storing identity-document images.

### 2. Establish ownership

Name every record and its authority. Reuse AWOS contact/task/review/CRM contracts. A local orchestration receipt must not become an independent truth about delivery or a duplicate contact database.

### 3. Design commands before UI

Define identity, tenant/owner, expected revision, payload, optional reason, timestamp/actor where applicable, idempotent replay result, and conflict errors. Distinguish rejected-before-admission from admitted-but-response-lost. Preserve evidence.

### 4. Bound actions and capabilities

Select existing enumerated actions. If the new domain genuinely needs more, propose a narrow SDK extension with tests and explicit review. A configuration field cannot silently introduce a new network destination, credential scope, arbitrary SQL, or executable code.

### 5. Reuse the interface

Use `public/module-ui.js`, `public/module-contract.js`, `public/style.css`, and `public/modules.css`. Escape dynamic content. Provide loading, empty, disabled, pending, conflict, and error states; keep keyboard focus and accessible names. Show actual verified state instead of substituting demonstration data on an error.

### 6. Prove interruption behavior

Test exact replay, duplicate command identity, changed payload, concurrent writers, owner isolation, response loss, restart, and SIGKILL around persistence. Add copy/restore coverage for every new store or record type. Explain limitations before enabling a real external effect.

### 7. Integrate and review

Run full suites and inspect the diff. Ship a synthetic example with no customer data. Document public contracts in English and preserve original-language evaluation fixtures. Report visual QA separately from renderer/controller tests.

## Connector contract, when added

Choose an official API or a reviewed MCP server per provider. MCP is a transport/tool protocol, not an authorization policy. Every connector needs identity/account binding, least-privilege scopes, credential storage, pagination and cursor semantics, quotas/backoff, provenance/idempotency, revocation/disconnection, retention, audit redaction, health, and recovery. Sending or mutating business records must reuse the applicable governed effect path.

WhatsApp, Telegram, Google Calendar, Odoo, WordPress, and CRM integrations are roadmap candidates. A manual opening link or a generic webhook is not an implemented native connector. Do not copy code from another project without checking and retaining its license and boundaries.
