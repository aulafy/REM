# Architecture guide

This guide describes the current REM foundation and its intended direction. **Source contracts and executed tests take precedence over diagrams or roadmap prose.** “Implemented” means present in this snapshot; it does not imply a production installation, successful live provider validation, or a security audit.

| Document | Purpose |
|---|---|
| [Architecture](architecture.md) | Layers, authority, execution modes, components, runtime/kernel responsibilities |
| [Data flows](data-flows.md) | Context DFD, stores, trust boundaries, module configuration and business workflow |
| [Modules](modules.md) | Versioned reusable contracts, permissions, FDE extension procedure |
| [Security and data](security-and-data.md) | Physical stores, copies, replay, uncertainty, threat boundaries |
| [Roadmap](roadmap.md) | What works, missing capabilities, priorities, acceptance and release gates |
| [Verification](verification.md) | Executed gates and explicit limits for the initial publication |
| [Development](development.md) | Setup, tests, source provenance, English publication boundary |

## Purpose

A small business should not need a different monolithic application for every profession. REM aims to offer a common workspace with reusable pieces: intake, identity, contacts, preparation, review, follow-up, closure, and history. A specialist adapts the business rules and interface while preserving the shared execution contracts.

## Principles

1. **Reuse domain components.** A module composes the existing runtime; it does not invent a second CRM or sender.
2. **Separate proposals from authority.** A model may produce text or a plan. It does not create permissions, approve a review, or declare a delivery successful.
3. **Make important state durable.** A restart, lost response, or power failure must not silently duplicate work or erase a decision.
4. **Bind decisions to exact versions.** Revised content requires a new applicable review and authorization.
5. **Keep uncertainty visible.** An uncertain external outcome remains uncertain until evidence resolves it. No blind resend.
6. **Minimize context and permissions.** Give a drafting model the requested context, not an entire business history by default.
7. **Design for adaptation.** Reviewed modules have explicit actions, capabilities, state, ownership, tests, and a recovery story.
8. **Describe reality precisely.** A saved draft is not a sent message. A synthetic test is not a live integration. A roadmap is not a feature list.

## Audience and scope

The repository primarily serves developers, FDEs, and integrators building a tailored local workspace for a professional or small team. It is not currently a hosted multi-tenant SaaS platform, a no-code arbitrary code marketplace, or an agent federation with verified customer delegation.

The first published snapshot includes the REM application and a curated AWOS runtime source tree. Personal development history, old handoffs, private model outputs, real data, credentials, and binary installers are excluded. Source provenance and file hashes are recorded in `PUBLICATION.json`.
