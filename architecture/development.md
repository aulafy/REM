# Development, tests, and publication scope

## Repository layout

```text
REM/
  public/              Browser interface, renderers, controllers, CSS
  src/                 Local API, AI routing, domain orchestration, persistence
  modules/             Reviewed reusable service entry points
  test/                Node tests and synthetic crash/recovery fixtures
  eval/                Original-language independent evaluation cases
  scripts/             Development, evaluation, QA, copy and packaging utilities
  dev/parallel/        Scoped AI worker configuration and example task plans
  architecture/        English system guide and DFDs
  docs/                English developer notes for the public snapshot
  runtime/awos/        Curated runtime source, tests, lockfile, MIT notice
  .github/             Continuous integration and contribution templates
  PUBLICATION.json     Source snapshot and publication file manifest
```

## Setup

Node 24 is the documented development version. Standalone REM has no npm product dependencies. The included AWOS workspace has its own existing lockfile and development dependencies; install those with:

```sh
npm ci --prefix runtime/awos
```

Do not install arbitrary global agent tools as part of running the application. AI credentials and weights are not included. The synthetic planner does not need a live model.

For a standalone temporary preview, follow the root README. For the governed synthetic preview:

```sh
node scripts/qa-awos.js --awos "$PWD/runtime/awos" --synthetic --port 4390
```

The helper prints its temporary root and local URL. The guard requires temporary marked separate stores, memory credentials, and no real connector variables. Do not disable those protections to use production data.

## Verification

```sh
npm test
npm test
npm test --prefix runtime/awos
npm run build --prefix runtime/awos
npm run typecheck --workspace=@agent-world/pymes --prefix runtime/awos
git diff --check
```

`test/helpers/awos-harness.js` defaults to the bundled runtime. `PYME1_AWOS_TEST_REPO` can point to a reviewed external checkout for integration work. Keep tests synthetic. The existing free-port helper does not change production port validation. Tests can start temporary processes and exercise real SIGKILL/restart; they must never target an installed application.

Renderer/controller tests do not replace browser QA. Record actual screen sizes, themes, actions, and captured evidence when visual QA is performed. Never label a static source review a visual pass.

## Evaluation and languages

`eval/casos.json`, `examen.json`, `examen2.json`, and `examen3.json` contain synthetic Spanish business requests and expectations. They are deliberately not translated together with interface copy. Translating them would change the acceptance measurement. Keep requests, fixtures, expected results, and scoring stable; add an independent suite for a new language.

Generated logs and `eval/results/` are ignored and excluded from publication. Run model measurements only with an explicitly selected provider/model and synthetic data. Report repetitions, variation, failures, raw output, latency, and warnings honestly. No hosted service is called by the ordinary synthetic test suite simply to produce a model score.

## AI development tools

`dev/parallel/opencode-packet.json` and `scripts/parallel-agents.mjs` support bounded development proposals. Plans name a frozen clean Git SHA, explicit model, source files, and disjoint patch surfaces. Worker results are kept outside the repository, are not applied automatically, and need coordinator review and tests.

OpenCode/Grok CLIs are optional separately installed developer tools, not REM product dependencies. Account availability and free-tier access vary. A CLI permission policy is not an OS sandbox. Do not attach credentials, customer messages, or private data. The example plan must be copied and given the current SHA before use; an old SHA is not silently substituted.

`gentle-rem.sh` optionally isolates a separately installed Gentle AI development profile. It does not install that stack or alter the application runtime.

## Public snapshot and provenance

The first REM publication uses a clean public Git history with selected source from the local development snapshots. It excludes internal handoffs, personal paths, old reports, databases, private evaluation outputs, generated binaries, node_modules, and historical Git objects. Original source snapshot identifiers, file hashes, and deliberate publication adaptations are recorded in `PUBLICATION.json`.

The bundled AWOS tree includes tracked implementation/workspace source and tests, rather than an unpinned reference to a developer's private checkout. Its root scripts expose the relevant test/build/typecheck operations; historical deployment and pilot instructions are not a production runbook for REM. Keep the upstream MIT notice. Future snapshot refreshes must identify source changes and rerun integration tests.

The public documentation and interface are English. Some implementation comments, domain values, prompts, test names, and language-specific synthetic content remain Spanish for compatibility and measurement integrity. They are not customer records. Do not rename internal protocol identifiers as a cosmetic translation.

No DMG is built or installed by publication. `scripts/build-mac.sh` remains a development packaging utility; executing it produces an ad-hoc-signed local artifact, not a notarized public release. Distribution is a separate gate.
