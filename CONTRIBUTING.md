# Contributing to REM

Thank you for helping build a reusable AI workspace for independent professionals and small businesses.

## Start with the actual contracts

Read the [architecture](architecture/README.md), [module guide](architecture/modules.md), [roadmap](architecture/roadmap.md), and [security policy](SECURITY.md). Check the current code and tests before proposing a replacement component. Clearly distinguish implemented behavior, synthetic demonstrations, and future design.

For a new business module or connector, open an issue explaining the user problem, minimal data, proposed contract, permissions, external effects, failure modes, recovery, and acceptance criteria. Agree on the boundary before building another sender, CRM, scheduler, or approval system.

## Development workflow

1. Fork the repository and create a focused branch.
2. Use Node 24 and install the bundled runtime with `npm ci --prefix runtime/awos`.
3. Use temporary synthetic data, an isolated port such as 4390, and in-memory secrets. Do not read or stop another installed instance.
4. Make one coherent change. Keep business behavior separate from presentation work.
5. Run REM's complete suite twice consecutively. If runtime code changes, run its suite, build, and typecheck too. See [development](architecture/development.md).
6. Run `git diff --check`, inspect the staged diff, and exclude data, logs, credentials, binaries, and `eval/results/`.
7. Open a pull request with evidence and limitations.

Do not add product dependencies without discussing why the existing implementation cannot meet the requirement. Do not relax production validation to satisfy a test. Tests use real free ports; port zero is not a workaround for a production configuration check.

## Pull request checklist

- What user problem does this solve, and which contracts change?
- Which files and stores own the result?
- Which commands/tests actually ran, with totals, failures, and skips?
- What happens on retry, concurrent commands, lost responses, restart, and SIGKILL?
- Does owner/tenant isolation still hold?
- Are previous reviews and decisions retained? Does a new payload require a new approval?
- Are customer text and model output treated as untrusted data?
- For UI changes: keyboard/focus, visible labels, light/dark mode, narrow screens, loading/empty/error/pending states. Attach synthetic screenshots only if actually captured.
- What is still unverified, particularly against real providers?
- Which AI tools assisted, and what did a human inspect or test?

Existing Spanish prompts and evaluation cases are language-specific acceptance data. Never change their wording, expected results, fixtures, or scoring to manufacture an improvement. Add independent evaluation coverage when expanding language support. An English interface alone does not establish English assistant capability.

## Safety and durable effects

A message draft approval saves a draft; do not rename that state to “sent.” Never delete claims or hide uncertainty to enable a retry. An `UNKNOWN` external effect must use the existing observation/reconciliation path. A proposed module must use reviewed, enumerated actions and explicit capabilities, not uploaded executable code.

Migration to a default governed product, real sending, and installation/distribution are separate release gates. A development or documentation contribution does not authorize those actions.

## Good first contributions

- Reproduce a bug with a synthetic fixture and a focused test.
- Improve English interface completeness and accessibility without changing business rules.
- Add independent English assistant evaluations.
- Specify a document checklist or local appointment module using the existing contracts.
- Design a connector with identity, scopes, cursors, quotas, recovery, and an explicit effects policy.
- Improve installation portability and audit the release boundaries.

## License and conduct

Contributions must be compatible with MIT and preserve existing notices. Submit only material you are entitled to share. Identify third-party code and its license. Be constructive, precise, and respectful; challenge a claim with a reproducible example. Report vulnerabilities privately when possible, not in a public issue containing an exploit against a real installation.
