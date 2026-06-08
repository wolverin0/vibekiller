# Production Readiness

The last 20% (security, errors, logging, deploy, compliance) is the job — AI gives you the first 80%.

- No secrets in client code/bundle — server-side env vars + proxy routes only. Rotate any exposed key.
- Validate input server-side (never trust client JS). Parameterized queries always.
- Rate-limit AND spend-cap expensive/paid/AI endpoints. Auth endpoints too.
- Every UI component needs 4 states: loading, error, empty, success.
- Heavy operations run async (job + id + idempotency), never inline in the request.
- Structured logging + error tracking + uptime monitoring before launch — not console.log.
- RLS / ownership checks on every user-data path (test: change the id in the URL).
- Staging env, atomic commits, one-click rollback. Migrations for every schema change.

Full reference: `~/.claude/context/production-readiness-playbook.md`. Self-check a project with `/vibe-to-prod`; full due-diligence with `/audit`.
