# Security policy

REM is a developer preview. There is no security certification, production support SLA, or independent assurance that every current workflow is ready for sensitive customer data.

## Report a vulnerability

Use GitHub's private vulnerability reporting option **if it is available** on this repository. Otherwise open an issue asking for a private reporting channel without including secrets, customer data, or operational exploit details. No private reporting address or response time is promised here.

## Current protections and boundaries

- The REM server binds to loopback, checks Host/Origin, and uses a per-start session token and a content security policy.
- Normal macOS credentials use Keychain; experimental QA uses memory. Other-platform fallback behavior must be reviewed before deployment.
- The experimental host demands separate marked temporary directories and an explicit non-production port, and rejects real connector configuration variables.
- Reviewed module manifests use enumerated actions and derived capabilities. They cannot upload arbitrary executable code or read secrets.
- Runtime claims, journal, reviews, bindings, and recovery must not be bypassed to retry an uncertain effect.

These are application boundaries, not an operating-system sandbox. They do not defend against malware running as the same user or make an Internet-exposed deployment safe. The application is not a multi-user SaaS service.

## Known gaps before a commercial deployment

The legacy external-errand path can dispatch an approved request outside AWOS. Not all effects currently share the governed runtime. Database and backup encryption, comprehensive private file permissions, outbound URL/TLS policy, retention, log review, prompt-injection threat modeling, an independent application authentication model, update signing, and production migration still need work. Partial anonymization is not a guarantee that all personal information is removed. A local-only AI routing option is not a universal network deny rule.

Do not expose the server beyond loopback, connect production customer accounts in synthetic QA, commit a database or OAuth JSON, or interpret a saved draft as a delivered message. Use temporary data for evaluation and keep model/provider credentials out of prompts, issue reports, logs, and screenshots.

See [storage and security](architecture/security-and-data.md) and the [release gates](architecture/roadmap.md).
