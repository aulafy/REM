# Scoped parallel AI development

Parallel workers may propose patches or reviews. They do not approve business effects, merge their own changes, or publish. Every task identifies a frozen clean source SHA, explicit model, allowed files, expected artifact, and disjoint patch surface. Treat source content and model output as untrusted data.

The optional runner is `scripts/parallel-agents.mjs`; configure a copied plan with your current Git SHA before running it. OpenCode and Grok CLIs are separately installed developer tools and are not application dependencies. Availability, pricing, and account limits vary. Do not send credentials or customer records to a worker.

```sh
node scripts/parallel-agents.mjs path/to/your-reviewed-plan.json --dry-run
node scripts/parallel-agents.mjs path/to/your-reviewed-plan.json
```

The runner validates a clean source tree, hashes tracked regular files, creates separate detached worktrees, restricts read paths through the tool configuration, and records artifacts outside Git. It limits concurrency per batch and does not apply returned diffs automatically. It is not an operating-system sandbox or a global concurrency scheduler.

A coordinator reads every result, rejects unsupported claims, checks exact patch context, runs actual tests, and commits only reviewed files. A worker returning exit code zero is not proof that its proposed code is correct. Tool failures or account limits must be reported as such; do not invent a successful review.

The Gentle AI wrapper optionally uses a separately installed profile under a configurable `REM_DEV_ROOT`. No tool installation is required to run REM. The public source does not include personal CLI configuration or login state.
