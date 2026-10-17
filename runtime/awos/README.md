# Bundled AWOS runtime source

This is a curated MIT-licensed source snapshot used by REM’s experimental synthetic host. The upstream notice is retained in LICENSE. See ../../PUBLICATION.json for the original source identity and hashes.

Install existing workspace dependencies from this directory with `npm ci`. Run `npm test`, `npm run build`, and `npm run typecheck --workspace=@agent-world/pymes`.

The REM entry point is `pymes/tests/fixtures/pyme1-harness.ts`. REM starts it with temporary stores, a process token, a synthetic planner and an operation allowlist. It does not expose real dispatch or reconciliation through REM. Additional runtime adapters, legacy prototype screens and tooling are source references, not a production deployment promise. Some original comments, prototype labels and synthetic domain tests remain Spanish.

Do not launch provider pilots or connect customer accounts merely because their implementations are present. Read the top-level architecture and security guide first. No historical deployment reports, account data, credentials, installers, or upstream Git history are included.
