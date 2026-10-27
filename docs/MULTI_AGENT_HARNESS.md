# Multi-Agent & Event Harness Guide (vInfiSSO + IChingNow)

Updated: 2026-10-27. Shared across `/Users/hoangvu96z/Documents/vInfiSSO` (NestJS SSO Backend & Admin UI) and `/Users/hoangvu96z/Documents/IChingNow` (SpiritNow Frontend Monorepo).

## 1. What is the Agent Harness?

An **Agent Harness** is the orchestration, safety, and verification framework surrounding AI models (Gemini 4 Argon, Gemini 3.8 Flash):

1. **Always-On Policy Injection (`.agents/rules/harness.md`)**: Inlines `AGENTS.md` and this guide on every turn (`trigger: always_on`).
2. **Parallel Multi-Agent Execution**:
   - **Native Subagents (`invoke_subagent`)**: Spawns parallel Argon (`Model: "pro"`/`"inherit"`) and Flash (`Model: "flash"`) workers inside Antigravity with strict file ownership boundaries.
   - **CLI Stream Harness (`scripts/agy-runner.mjs`)**: Runs single or parallel `agy` CLI workers (`--output-format stream-json`), redacts secrets/tokens, logs events to `.agy-runs/*.jsonl`, and computes Git worktree deltas (`diffSnapshots`).
3. **Verification Gate**: All changes must be verified via independent diff review and test execution (`npm test`, `npm run test:agy-runner`, `npm run build`, and `npm run test:sso` in `IChingNow` when SSO contracts change).

---

## 2. Parallel Execution Mode A: Native Subagents (`invoke_subagent`)

| Subagent Role | Recommended `Model` | Best Used For |
| --- | --- | --- |
| `argon-worker` | `"inherit"` or `"pro"` (Gemini 4 Argon) | NestJS modules (`src/sso`, `src/auth`, `src/security`, `src/readings`, `src/journal`, `src/payments`, `src/plans`), TypeORM migrations, cross-repo SSO contracts |
| `flash-worker` | `"flash"` (Gemini 3.8 Flash) | `admin-ui/` React/Vite components, isolated NestJS DTOs/specs (`*.spec.ts`), parallel frontend app updates in `/Users/hoangvu96z/Documents/IChingNow` |
| `qa-verifier` | `"flash"` (Gemini 3.8 Flash) | Running Jest unit/e2e tests, `npm run build`, and cross-repo SSO regression tests |

---

## 3. Parallel Execution Mode B: CLI Harness (`scripts/agy-runner.mjs`)

### Single-Agent Run
```bash
mkdir -p .agy-runs/tasks
npm run agy -- \
  --task-file .agy-runs/tasks/sso-guard.md \
  --model gemini-4-argon-high \
  --effort high \
  --mode accept-edits
```

### Parallel Multi-Agent Run (Argon + Flash)
Create `.agy-runs/tasks/jobs.json`:
```json
[
  {
    "name": "backend-sso",
    "cwd": "/Users/hoangvu96z/Documents/vInfiSSO",
    "taskFile": ".agy-runs/tasks/backend-sso.md",
    "model": "gemini-4-argon-high",
    "effort": "high",
    "mode": "accept-edits"
  },
  {
    "name": "admin-ui",
    "cwd": "/Users/hoangvu96z/Documents/vInfiSSO",
    "taskFile": ".agy-runs/tasks/admin-ui.md",
    "model": "gemini-3.8-flash-high",
    "effort": "high",
    "mode": "accept-edits"
  },
  {
    "name": "frontend-shared",
    "cwd": "/Users/hoangvu96z/Documents/IChingNow",
    "taskFile": ".agy-runs/tasks/frontend-shared.md",
    "model": "gemini-3.8-flash-high",
    "effort": "high",
    "mode": "accept-edits"
  }
]
```

Run in parallel:
```bash
npm run agy:parallel -- --jobs .agy-runs/tasks/jobs.json --max-concurrency 3
```
