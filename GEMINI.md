# vInfiSSO — Antigravity Workspace Entry Point

Mandatory workspace policy: `.agents/rules/harness.md` (`trigger: always_on`, Rule ID: `VINFISSO_MULTI_AGENT_HARNESS_V1`). It inlines `AGENTS.md` and `docs/MULTI_AGENT_HARNESS.md` on every turn.

- For multi-part tasks across `vInfiSSO` and `IChingNow`, dispatch parallel subagents (`invoke_subagent` with `Model: "pro"`/`"inherit"` for Argon or `Model: "flash"` for Flash) or run the CLI harness (`npm run agy` / `npm run agy:parallel`).
- Never inspect or expose `.env*` or `tudien.sql`. Verify backend changes with `npm test` and `npm run build`.
