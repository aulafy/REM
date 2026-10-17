# AI assistance and attribution

REM has been designed and developed through collaboration between its human creator and several AI tools:

- **Grok** (xAI), for exploration, research, and development discussion.
- **Claude** (Anthropic), for architecture, implementation deliveries, and review.
- **Codex** (OpenAI), for implementation, integration, tests, documentation, and interface work.
- **Local open-source and open-weight models**, including Qwen and Llama model families, for inference experiments and independent evaluations.
- **OpenCode**, including access to DeepSeek models, for development proposals and scoped parallel review.

This is a project-level acknowledgement. It does not mean each tool contributed to every file, every model ran locally, or every proposed change was accepted. Provider availability, model versions, licenses, and pricing vary. “Open-weight” is not synonymous with “open-source,” and REM's MIT license does not relicense model weights, hosted services, or their outputs under unrelated terms.

## Responsibility and review

AI output is a proposal, not authority. The integrating developer reviews source contracts, checks scope, runs tests, documents failures and limits, and decides what to merge. Workers should have a fixed source snapshot, a bounded task and file scope, no customer records or credentials, and no authority to publish, approve business effects, or alter another worker's changes.

Parallel review does not establish correctness by consensus. Tool-level permissions are not an OS sandbox. Recovery tests, independent evaluations, source review, and actual provider validation serve different purposes and must be reported separately.

Contributors should disclose material AI assistance in pull requests and distinguish commands actually executed from suggested tests. Do not claim a result from a model's unverified narrative. Do not tune rules to the exact wording of an acceptance exam.

Product and company names remain their owners' trademarks. This acknowledgement does not imply endorsement, sponsorship, or affiliation.
