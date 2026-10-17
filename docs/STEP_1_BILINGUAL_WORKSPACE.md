# Step 1 — Spanish / English workspace

Base: `3321d4b45409e49d2cb553ea95c5c2871a2aa8a2` · branch: `feat/bilingual-workspace`.

## Product change

Settings → Language switches the workspace immediately, without reloading. First use chooses the primary browser language (`es` or `en`), otherwise Spanish. The existing settings store persists the choice. A failed settings save is visible and rolls an explicit change back. No model is selected, downloaded or called by choosing a language.

The assistant, pasted-message triage and experimental proposal editor offer a separate language for new drafts. Existing customer text, drafts, template versions, decisions and review payloads are retained literally. Changing the interface language never translates an approved draft or grants approval to a new one.

## Contracts

| Boundary | Change |
|---|---|
| Settings | Optional persisted `language: "es" \| "en"`; legacy absence remains valid |
| HTTP | Optional `x-rem-language` controls error presentation per request; authorization, status and error codes remain unchanged |
| Assistant / triage | Optional `draftLanguage: "es" \| "en"`; draft payload retains `idioma` metadata |
| Experimental draft / suggestion | Optional `language`; existing local-only transport and minimum-context writer |
| Proposal templates | Optional versioned `language`; additive nullable column in REM's `proposal_templates` |
| REM orchestration | Additive nullable language metadata in `awos_op_templates`; included in command identity and retained after restart |
| AWOS | No change to bundled runtime source, schemas, review bindings, claims, journal or effect authority |

A template's text must already be in its declared language. Selecting another language asks the user to create an appropriate template version; it does not silently translate reviewed commercial text. Templates without language retain their legacy Spanish interpretation. Canonical money variables keep the existing `1234.50 EUR` representation; localized rendering uses `Intl`. Existing calls without a language retain their original output.

Follow-up text follows the language of its source template, independently of later interface changes. It still creates a separate pending review, through the existing flow.

## Interface implementation

- `public/i18n/es.json` and `en.json` own interface copy, accessible labels, errors, warnings and empty states. No new product dependency.
- Static HTML renders by key on the server and updates its `lang` and localized attributes on the client. Customer values remain escaped at the existing renderer boundaries.
- Dynamic translations retain matching placeholders and nonlinguistic markup, including command identifiers. Locale refresh patches text/attributes while preserving live form nodes and async handler references.
- Unsaved field values, passwords held in memory, focus/selection, checkboxes, disabled/hidden controls and pending-command guards survive a locale refresh. These snapshots are never serialized, logged or persisted.
- A structurally different business subtree is retained until its normal authoritative render instead of replacing a pending form to force a translation. Switching locale does not trigger a business read, write, approval or retry.
- `Intl` uses `es-ES` / `en-GB` and `Europe/Madrid`. Follow-up wall times are interpreted in Madrid even when the browser/host is elsewhere. Spring gaps are rejected; a repeated autumn hour selects the first occurrence, retaining the previous Madrid parser convention.
- Recognized API messages translate by key. Unrecognized provider diagnostics use a localized generic message with their original error code; raw provider details are not exposed as interface copy.

The writer still sees only the literal request, recipient and channel, plus specifically requested records. English weekday/relative-date recognition and absolute-date warnings are covered with independent synthetic unit cases. Relative deadlines remain literal. No existing evaluation request, fixture, expected answer or scoring file was changed. These tests do **not** establish measured English model accuracy.

## Verification and review gate

REM: **264/264 passing, twice consecutively**, including the original crash/recovery and copy suites. New coverage checks catalogue parity and referenced keys, placeholder/markup contracts, fixed UI copy, preference save/failure/restart, editing and async-node preservation, request-isolated errors, writer isolation and draft overrides, versioned templates, authoritative AWOS review recovery, and Madrid DST behavior from three host zones.

`node scripts/check-i18n.mjs`: **824 matching keys, no findings**. The development audit uses the TypeScript parser already installed with the bundled runtime; REM's product dependency list is unchanged. The original English presentation test now checks rendered translated HTML instead of expecting raw fixed English source. Other existing test expectations are unchanged.

`git diff --check`: clean. JavaScript syntax checks: clean.

Bundled AWOS source is unchanged; REM integration tests start only temporary synthetic runtimes. CI additionally runs the bundled runtime suite, typecheck and build.

**Visual QA: pending, to be done by Claude.** The local browser automation access was denied in this session; an alternative route was not used to bypass that restriction. Node controller/tree tests and HTTP checks are not a visual pass. Review in both languages and themes, desktop and **375 px**:

1. Settings switch with unsaved profile/credential fields; verify no reload or lost focus/value, then restart and verify persistence.
2. Assistant and triage composer labels, language selectors, wrapping, errors and empty states; inspect the console, including catalogue module loading in Safari.
3. Module configuration after a lost response/conflict: fields and command identity remain locked; only deliberate recovery can proceed.
4. A pending proposal, an older decision and an UNKNOWN result: exact content retained; approval never labelled sending; no retry for UNKNOWN.
5. Template editor/version history, matching-language money preview and separate draft language; customer text never translated automatically.

No real data, installed instance, model service, Keychain, OAuth account, external effect or installer was used for this step. No DMG was built. No Step 2 implementation is included. Keep this PR unmerged until the visual review returns concrete results.
