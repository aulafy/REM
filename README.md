# REM

### A workspace you can shape around your business.

REM is an MIT-licensed foundation for building AI-assisted web applications for independent professionals and small businesses. It brings together a local workspace, reusable business modules, an AI proposal layer, and an experimental integration with a durable agent runtime.

The goal is practical: **start from working building blocks, adapt them to a real business, and keep important decisions accountable.** An implementer or forward-deployed engineer (FDE) can reuse the contracts and interfaces instead of rebuilding contacts, reviews, recovery, and process history for every customer.

**Status: developer preview.** This is an evolving source project, not a turnkey production service or a finished autonomous business agent. The interface is being published in English; existing Spanish prompts and synthetic evaluation cases retain their original language so their meaning and scoring are preserved.

## Who it is for

- **Independent professionals** who want a workspace adapted to their actual services and client relationships.
- **Small businesses** that need a manageable foundation for repeatable administrative and commercial processes.
- **FDEs, agencies, and integrators** building a tailored installation for a client.
- **Developers and researchers** exploring accountable AI workflows, modular interfaces, and recovery after interruption.

Insurance is one development use case, not a restriction on the architecture. An accountant, consultant, repair business, or small agency could reuse the same foundations with different business rules. Each adaptation still needs domain review, permissions, and acceptance tests.

## What is available

| Piece | Current state |
|---|---|
| Local web workspace | Contacts, tasks, assistant, pasted-message triage, proposal review, activity, settings, and backups |
| AI routing | Configurable local model and optional external providers; model access is not included |
| Message drafts | Review and save; optionally open a draft in Mail or WhatsApp. **Approval does not send a message** |
| Reusable modules | Requests, proposals, follow-ups, and response/closure, through the experimental AWOS host |
| Module library | Reviewed manifests, explicit capabilities, configuration revisions, pause/resume, and configuration history |
| Recovery | Durable commands, restart/crash coverage, and coordinated copies of the current experimental stores |
| Runtime source | A curated AWOS source snapshot is included in `runtime/awos`, with its own existing dependencies and MIT notice |
| Documents and appointments | Planned; development cards are not installable implementations |
| Automatic SaaS ingestion and real sending through REM | Not enabled by this integration |
| Customer AI ↔ business AI | Roadmap, not a completed federation protocol |

There are currently **two execution paths**. The standalone application is the older local workflow. The experimental AWOS path owns governed CRM/review state. A legacy approved external *errand* can call a configured webhook or A2A endpoint outside AWOS. This must be converged before claiming that every external effect is governed by the runtime. See [architecture](architecture/architecture.md) and [security](SECURITY.md).

## Try it with temporary data

Use Node.js **24** for the documented development setup. REM's declared minimum is 22.13; its embedded SQLite API and runtime tooling require a compatible Node version. macOS is the primary desktop development environment; this is not a published support matrix.

```sh
git clone https://github.com/aulafy/REM.git
cd REM

# No npm install is needed for the standalone REM application.
REM_DEMO_DATA="$(mktemp -d)"
node scripts/seed-sintetico.js --data-dir "$REM_DEMO_DATA" --count 100 --seed 42
PYME1_DATA_DIR="$REM_DEMO_DATA" PYME1_SECRETS=memory PYME1_PORT=4390 npm run dev
```

Open `http://127.0.0.1:4390`. If that port is occupied, read the printed address; normal mode tries the following ports. Stop this temporary server with Ctrl+C. Memory secrets disappear on shutdown. The seed contains fictional Spanish business content; it is not customer data.

A model is not required to inspect the interface. To generate proposals, explicitly configure an installed local model or an external provider in Settings. No model is downloaded or selected automatically. Existing assistant intent/date tests are Spanish: do not assume English-language assistant accuracy from an English interface.

**Do not use plain `npm start` for an isolated experiment:** without an explicit data directory it opens the normal application data location. Existing `PYME1_*` identifiers remain for compatibility with earlier Pyme_1 versions.

### Try the governed modules without sending

```sh
# Installs only the runtime's existing locked development/workspace dependencies.
npm ci --prefix runtime/awos
node scripts/qa-awos.js --awos "$PWD/runtime/awos" --synthetic --port 4390
```

This creates a separate temporary environment, uses in-memory credentials and fictional `example.test` contacts, and starts the synthetic planner. The host does not expose execute or reconcile routes to REM. Close another temporary server first if it occupies 4390; never stop an unrelated installed instance.

The runtime snapshot contains additional development capabilities. Their presence in source is **not** permission to connect production accounts or expose the runtime server publicly.

## Architecture and implementation guide

Start with the [architecture index](architecture/README.md):

1. [Layers, authority, and execution paths](architecture/architecture.md)
2. [Data-flow diagrams and trust boundaries](architecture/data-flows.md)
3. [Reusable module contracts and an FDE implementation recipe](architecture/modules.md)
4. [Storage, recovery, and security boundaries](architecture/security-and-data.md)
5. [Roadmap and unfinished work](architecture/roadmap.md)
6. [Development, tests, and publication scope](architecture/development.md)

The design philosophy is **reuse before duplication; AI proposes within a contract; durable state outranks a visual label; uncertainty remains visible; and configuration does not grant arbitrary code execution.** Local-first means the workspace can keep business data locally. It does not mean every configured provider or external errand runs offline.

## Tests

```sh
npm ci --prefix runtime/awos
npm test
npm test
npm test --prefix runtime/awos
npm run build --prefix runtime/awos
npm run typecheck --workspace=@agent-world/pymes --prefix runtime/awos
git diff --check
```

REM uses the built-in Node test runner. Integration fixtures default to the included runtime, or an explicitly supplied `PYME1_AWOS_TEST_REPO`. They use synthetic data and temporary databases. Real provider/model tests are separate opt-in work; passing synthetic tests is not proof of a live Gmail integration or model accuracy.

## Built with human review and AI assistance

The project has been designed and developed with assistance from **Grok, Claude, Codex, local open-source/open-weight models, and models accessed through OpenCode, including DeepSeek**. Assistance spans implementation proposals, review, evaluation, documentation, and interface work. Tool output is reviewed; a model is not an approval authority. See [AI assistance and attribution](AI_ASSISTANCE.md) for scope and licensing distinctions.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md). Useful contributions include reproducible bug reports, accessible interface improvements, module implementations, connector contract design, English assistant evaluations, recovery tests, and clearer documentation. Discuss new capabilities before implementing new external effects.

Please do not include customer records, credentials, OAuth downloads, private conversation histories, or generated evaluation logs in issues or pull requests.

## License

REM is distributed under the [MIT License](LICENSE). The bundled AWOS source retains its [MIT notice](runtime/awos/LICENSE). External services, AI model weights, and installed dependencies have their own terms and licenses; the repository does not relicense them.
