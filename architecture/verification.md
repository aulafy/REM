# Initial publication verification — 2026-10-17

Verification ran against the curated public checkout with Node 24.21.0 on macOS. These results describe this source snapshot, not the user's installed application or a live-provider acceptance run.

| Gate | Actual result |
|---|---|
| REM complete suite, consecutive final run 1 | 247 tests; 247 passed; 0 failed/skipped/cancelled |
| REM complete suite, consecutive final run 2 | 247 tests; 247 passed; 0 failed/skipped/cancelled |
| Bundled runtime complete workspace suites | 1,061 tests; 1,060 passed; 0 failed; 1 optional live-provider test skipped |
| Runtime PYMES typecheck | Passed |
| Runtime workspace build | Passed |
| REM public JavaScript syntax checks | 12 files passed |
| Patch whitespace check | Passed |
| Existing runtime dependency audit | 0 vulnerabilities reported after the scoped lockfile fix |
| Isolated synthetic HTTP smoke test | 8 checks passed; GET requests only; no business approval or dispatch |
| Browser visual QA | Not performed; not represented by HTTP or renderer/controller tests |
| Live Gmail, customer connectors, production migration | Not performed or authorized by this publication |
| Installer build/installation | Not performed |

## Interface change and acceptance integrity

The interface copy, accessible labels, warnings, English date display, recovery text, settings, and module presentation were translated. A small presentation alias table covers built-in legacy labels without rewriting authoritative records. Four new tests cover English navigation with stable domain identifiers, alias behavior including prototype-looking strings, immutable/escaped module rendering, and preservation of warning values.

Nine existing test files received minimal expected-copy changes; an additional DST test changed only its translated validation-message expectation. Authorization, payloads, IDs, scopes, decision bindings, effect state, recovery, escaping, and assertions about absence of controls were retained. The Spanish acceptance cases, fixtures, AI prompts, and scoring were not translated or tuned.

Stored client text, generated drafts, original-language sample content, and provider messages are not rewritten into English to conceal results. English-language assistant quality remains unmeasured and is separate roadmap work.

## Runtime packaging and dependency fix

The original runtime implementation and tests were selected from the source snapshot recorded in PUBLICATION.json. No old Git history, internal reports, credentials, databases, private outputs, node_modules, or installers were exported. The root runtime scripts were scoped to the documented developer gates.

The initial install reported a high-severity transitive development dependency advisory for `source-map-js` 1.2.1. The published lockfile updates **only that package** to 1.2.2, retaining the existing dependency graph and product manifests. See the [upstream advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Installation, audit, complete suites, typecheck, and build were then verified using the published dependency tree.

## HTTP smoke test scope

A newly created temporary experimental environment used memory credentials, the included synthetic host, and an isolated free port. Checks confirmed the English HTML document/navigation, served JavaScript assets, unauthorized catalog rejection, four active reviewed modules, and zero business operations. The temporary processes and directories were closed after the test. The installed default-port application and real account data were not read or stopped.

## Publication hygiene and limits

Selected source was inspected for credential signatures, private-key blocks, personal machine paths, pilot addresses, unexpected binary/data files, and source provenance. Synthetic negative-test addresses and deliberately constructed fake credential strings are not account credentials. Pattern scanning does not constitute a comprehensive security audit.

Remaining release blockers include legacy external-effect convergence, production data migration/rollback, broader storage/egress/retention hardening, completed visual QA, and live governed sending acceptance. See the roadmap and SECURITY.md. No end-to-end safety or production-readiness claim follows from these test totals.
