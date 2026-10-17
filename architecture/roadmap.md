# Roadmap and unfinished work

The purpose is a tailored, accountable AI workspace. A useful foundation is published now; the following milestones describe work still required for a professional installation. No completion dates or production SLA are promised.

## Current implementation

| Area | Status | Qualification |
|---|---|---|
| Standalone local workspace | Implemented | Legacy flow, Spanish assistant/domain fixtures, English presentation |
| AI proposal/drafting context | Implemented | Model quality varies; independent evaluations remain essential |
| Contacts/tasks/review/activity | Implemented | Legacy records are distinct from governed AWOS records |
| Governed synthetic integration | Implemented | Separate temporary host; no real sending exposed by REM |
| Four reusable modules and library | Implemented | Requests/proposals/follow-ups/closure; reviewed SDK v2 plus v1 compatibility |
| Durable follow-ups and closure | Implemented | No assertion that scheduling proves an email was sent |
| Coordinated copy/recovery | Implemented for current inventory | Does not automatically cover future stores or credentials |
| Visual QA of the full current interface | Pending | Pure renderer/controller tests and HTTP checks are not screenshots |
| Documents and appointments modules | Not implemented | Development cards only |
| Default AWOS migration | Gated, not implemented | Requires explicit release approval and a reversible migration |
| Governed real sending from REM | Gated, not enabled | Must reuse existing adapters/runner; requires live acceptance evidence |
| Customer-agent federation | Design direction | Identity/delegation/consent/revocation required |

## Priority 0 — trustworthy reusable foundation

- Finish English presentation coverage and independently evaluate English assistant requests.
- Complete visual QA for desktop/narrow screens, both themes, keyboard focus, large text, empty/error/pending/conflict states.
- Close any cross-task source/precondition race during follow-up preparation before enabling dispatch.
- Converge approved external errands onto the common governed effect authority.
- Make storage permissions, retention, egress/TLS policy, logs, and recovery scope explicit and verified.
- Improve onboarding: what data stays local, what leaves for a configured service, what approval actually does, and what is unavailable.

## Next module — document checklist

Begin with metadata, not sensitive document uploads. A requirement belongs to an existing case/contact, with pending/received/not-applicable states and provenance. Repeated commands must not duplicate requirements. A reminder must prepare through the existing review flow. Closure/history and ownership must remain intact.

Acceptance: explicit domain commands, expected revisions, owner/tenant isolation, immutable historical decisions, restart/SIGKILL/replay coverage, copy/restore, and visible real error states. Do not add a separate sender or undocumented attachment store.

## Next module — local appointments

Start with explicit local availability and appointments. Define timezone (initial business examples use Europe/Madrid), DST behavior, conflicts, rescheduling/cancellation, stable command identities, and history. Do not imply Google Calendar synchronization until a connector actually exists.

Acceptance: overlap checks, ambiguous/nonexistent DST times, revision conflicts, duplicate commands, restart/replay, cancellation history, and recovery/copy tests.

## Connector track

Candidate providers: WhatsApp Business, Telegram, Google Workspace, Odoo, WordPress, and selected CRMs. Choose an official API or reviewed MCP interface for each use case after checking provider constraints. There is no universal connector that makes identity, scopes, cursor recovery, delivery evidence, or licensing disappear.

Start read-only where useful. Add mutations only through explicit contracts, authorization, effect claims, and reconciliation. Each connector needs synthetic tests plus separately documented real-provider acceptance. Do not expose old pilot accounts or credentials through a public demo.

## Release gates requiring an explicit decision

### Gate 7 — experimental to normal product

Unify authority, preview data mapping, preserve legacy history, validate backups, run migration/rollback tests, and define failure recovery. Do not silently make experimental AWOS the default.

### Gate 8 — real external sending

Reuse the existing Governed Runner and adapter contracts. Validate exact approval binding, normal send, restart with preserved authorization, and provider-accepted/lost-response → UNKNOWN → SIGKILL → recovery/reconciliation without duplicate dispatch. No new hidden sender. Live success must be evidenced, not inferred from a synthetic test.

### Gate 9 — distribution

Define supported platforms, signing/notarization, installation, updates, permissions, restore, uninstallation, and support. Source publication does not imply an installer is notarized or a migration is authorized. No installer is generated by this publication task.

## Longer-term customer AI ↔ professional AI

A customer agent could negotiate a bounded request with the professional's workspace with minimal intervention. First define verifiable identity, delegated authority, bounded actions/budgets, revocation, consent, provenance, contractual limits, and escalation. The model's wording cannot create authorization. Current generic A2A/webhook experiments do not yet supply this full protocol.

## Evidence to collect

Use real pilot tasks with consent after the relevant gates: time to first useful result, manual corrections, proposal acceptance, unresolved uncertainty, duplication rate, recovery outcomes, and user comprehension of approval. Proposed metrics are not achieved results. Avoid advertising “fully autonomous,” “100% accurate,” or “ready for any profession” without applicable evidence.
