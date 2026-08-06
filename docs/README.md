# Nightforge Documentation

Local documentation index (Roadmap Phase 7). The authoritative design
specification lives in the `Guide/` directory at the repository root.

## Getting started

| Document | Purpose |
|----------|---------|
| [README](../README.md) | What Nightforge is, quick start, configuration |
| [Setup wizard](../README.md#quick-start) | `npm run setup` builds a valid `.env` |
| [Diagnostics](../README.md#quick-start) | `npm run diagnostics` checks an installation |
| [LINEAR-SETUP.md](./LINEAR-SETUP.md) | Linear workspace, states, webhook, epic label |

## Running Nightforge

| Document | Purpose |
|----------|---------|
| [OPERATIONS.md](./OPERATIONS.md) | Backup, upgrade, rollback, Docker deployment |
| [SECURITY.md](../SECURITY.md) | Threat model and security policy |
| [Benchmark](../README.md#development) | `npm run bench` — deterministic routing benchmark |

## Extending Nightforge

| Document | Purpose |
|----------|---------|
| [PROVIDER-SDK.md](./PROVIDER-SDK.md) | Add a new model provider |
| [INTEGRATION-SDK.md](./INTEGRATION-SDK.md) | Connect a new external system |
| [CONTRIBUTING](../CONTRIBUTING.md) | Contribution workflow |

## Design specification

The `Guide/` folder holds the v2.1 specification the implementation
follows:

- `NIGHTFORGE-V2.1.md` — full system specification
- `NIGHTFORGE-IMPLEMENTATION-ROADMAP-V2.1.md` — phased roadmap
- `NIGHTFORGE-MODEL-ROUTING-V2.1.md` — tiered routing design
- `NIGHTFORGE-AGENT-PROMPTS-V2.1.md` — agent role registry and prompts
- `NIGHTFORGE-UI-UX.md` — dashboard direction (deferred)
- `PHILOSOPHY.md` — blast-radius deployment policy
