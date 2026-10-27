# vInfiSSO — Rules for Coding Agents

Rule ID: `VINFISSO_MULTI_AGENT_HARNESS_V1`

Read and follow [MULTI_AGENT_HARNESS.md](docs/MULTI_AGENT_HARNESS.md) before any coding task. Applies across `/Users/hoangvu96z/Documents/vInfiSSO` (`src/`, `admin-ui/`, `migrations/`, `scripts/`, `test/`) and cross-repo SSO integration with `/Users/hoangvu96z/Documents/IChingNow`.

## 1. Discovery & CodeGraph Policy

- `.codegraph/` is initialized in `/Users/hoangvu96z/Documents/vInfiSSO` (223 files, 2,784 nodes, 119 routes). Always call `codegraph explore` / `codegraph node` before reading source files. If the index is stale, run `codegraph status` and `codegraph sync`.
- Before changing SSO endpoints, JWT payloads, reading/journal encryption, quota/plans, or streak APIs, check callers and downstream impact on `/Users/hoangvu96z/Documents/IChingNow/shared`.

## 2. Multi-Agent & Parallel Execution Policy (Argon + Flash)

Partition multi-part tasks into non-overlapping modules (`src/sso`, `src/readings`, `src/journal`, `src/streak`, `src/payments`, `admin-ui/`, or frontend apps in `IChingNow`) so multiple agents can execute in parallel:

- **Model Selection**:
  - **Argon (`gemini-4-argon-high` / `gemini-4-argon-medium` or Subagent `Model: "pro"` / `"inherit"`)**: Use for NestJS architecture, SSO/OAuth/JWT security, AES reading encryption (`src/security`, `src/readings`, `src/journal`), TypeORM migrations, payment/plan guards, and cross-repo API contracts.
  - **Flash (`gemini-3.8-flash-high` or Subagent `Model: "flash"`)**: Use for parallel `admin-ui/` components, DTO/controller boilerplate, Jest unit tests (`*.spec.ts`), documentation, and parallel frontend updates in `IChingNow`.
- **Execution Modes**:
  1. **Native Antigravity Subagents**: Invoke `argon-worker`, `flash-worker`, and `qa-verifier` via `invoke_subagent` concurrently in the same turn with disjoint file ownership (or `Workspace: "share"` / `"branch"`).
  2. **CLI Event Harness (`npm run agy` / `npm run agy:parallel`)**: Delegate single tasks with `npm run agy -- --task-file <path> --model <model>` or parallel multi-agent batches with `npm run agy:parallel -- --jobs <manifest.json>`. Never pass `--dangerously-skip-permissions`.

## 3. Security & Business Invariants

- Never read, log, or commit `.env`, `.env.production`, JWT secrets, encryption keys, OAuth client secrets, or `tudien.sql`.
- Preserve reading/journal encryption integrity (`encrypt-readings`, `recover-legacy-readings`) and never log plaintext user readings or tokens.
- Run relevant Jest tests (`npm test`, `npm run test:agy-runner`) and `npm run build` before handoff. Do not run production migrations, commit, push, or deploy unless explicitly requested.

## 4. Mandatory GitHub Actions Build & Deploy Gate

- Repositories: `hoangvu96z/vInfiSSO` and `hoangvu96z/IChingNow`.
- After any authorized `git push`, you **MUST** verify that the GitHub Actions `CI` and `Deploy vInfiSSO` workflows for the exact pushed commit SHA (`HEAD`) complete with `conclusion: success` **before moving to the next task on the list**.
- Use the connected `github-actions` MCP (`github_actions_wait` / `github_actions_status`), GitHub MCP (`.codex/config.toml`), or run `npm run ci:wait` from the repository root.
- Do not treat a `queued`, `in_progress`, `cancelled`, or missing run as a pass. If any workflow or deploy job fails, inspect the failed step logs, fix the root cause, push a new commit, and re-verify `npm run ci:wait` until green.
