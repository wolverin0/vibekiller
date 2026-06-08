# vibekiller

**Kill the vibe-coding gap.** AI writes the first 80% of an app — the features, the
happy path. The last 20% — security, error handling, logging, deployment, cost
controls, compliance — is the engineering that separates a *demo* from a *product*.
vibekiller is a Claude Code toolkit that finds the missing 20%.

It ships two entry points:

| Command | What it is | When |
|---|---|---|
| **`/vibe-to-prod`** | A fast, guided **13-layer self-check**. Walks the production stack, runs cheap detections + manual tests, emits a PASS/GAP scorecard and a prioritized "finish the boring 20%" list. | "Is my app ready to ship? What am I missing?" |
| **`/audit`** | A full **multi-domain technical due-diligence audit** in an isolated subagent. Hard-stops, blind-spots, 13 domains, a deterministic verdict, and a dual-layer report with `path:line` evidence for every finding. | Acquisition-grade review, pre-launch gate, "prove it's ready." |

Both are grounded in the **production-readiness playbook** (`context/production-readiness-playbook.md`) — a distillation of the 13-layer production stack and the recurring ways AI-generated apps break.

---

## The 13-layer production stack

Most vibe-coded apps ship 2 layers (front-end + database). The other 11 are the gap:

1. Front-end foundations (4 UI states, a11y, bundle) · 2. APIs & back-end logic ·
3. Database & storage · 4. Auth & permissions (RLS, IDOR) · 5. Hosting & deployment ·
6. Cloud & compute · 7. CI/CD & version control · 8. Security & RLS ·
9. Rate limiting · 10. Caching & CDN · 11. Load balancing & scaling ·
12. Error tracking & logs · 13. Availability & recovery.

---

## What `/audit` checks

- **Hard stops (H1–H11)** — conditions that lock the verdict to 🛑 DO NOT LAUNCH:
  RLS off, admin secrets in client, unauthed mutations, secrets in git history,
  unverified webhooks, stored XSS, SQL injection, hardcoded admin bypass, tests that
  assert buggy critical flows, **unbounded cost on a paid/AI endpoint (H10)**, and a
  **paid-API secret shipped in the client bundle (H11)**.
- **Blind spots (B1–B19)** — patterns that look correct to an AI reviewer but aren't:
  auth-not-wired, error-handlers-returning-success, IDOR, missing idempotency, and
  the vibe-coding additions **sync-heavy-op (B16)**, **missing-cache (B17)**,
  **non-idempotent user action (B18)**, **UI missing one of 4 states (B19)**.
- **Tambon LLM-signature hunt** — hallucinated objects, wrong attributes, silly mistakes.
- **13 domain audits** — security, architecture, database, devops, performance, UX/a11y,
  reliability, compliance, maintainability, cost, demo-vs-prod, missing, code-integrity —
  each enriched with concrete vibe-coding checks and run in its own isolated subagent.
- **Deterministic verdict** — one of five exact strings, triggered by findings (not a
  gameable score), plus a phased remediation plan with dev-day estimates.
- **Discipline rules R1–R7** — evidence-or-silence, quote-before-cite, severity honesty,
  exploitability tagging, prompt-injection immunity, completion honesty, stack honesty.

Per-finding fix prompts are available on demand via `audit-fix-generator`.

---

## Install

### Option A — install script (works for any Claude Code user)

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/vibekiller
cd vibekiller
./install.sh           # macOS / Linux / WSL / Git-Bash
#   or on Windows PowerShell:
#   ./install.ps1
```

This copies `skills/`, `agents/`, `commands/`, `context/`, `rules/`, and `hooks/`
into `~/.claude/`. Restart Claude Code afterward.

### Option B — as a Claude Code plugin

```
/plugin marketplace add YOUR_GITHUB_USERNAME/vibekiller
/plugin install vibekiller@vibekiller
```

The plugin delivers the skills, commands, and agents. The **context files and the
optional rule still need the install script** (or a manual copy of `context/` →
`~/.claude/context/` and `rules/` → `~/.claude/rules/`), because those aren't part
of the standard plugin surface.

> Before publishing your fork, replace `YOUR_GITHUB_USERNAME` in
> `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and this README.

---

## Usage

```
/vibe-to-prod                     # fast self-check of the current project
/audit                            # full audit, all 13 domains (40–70 min)
/audit --scope=src/api            # audit only a subtree
/audit --priority-domains=1,5,7   # only these domains (faster)
/audit-fix F-1.3                  # generate a fix prompt for a specific finding
```

---

## Optional wiring

- **Always-on rule** — add to your `~/.claude/CLAUDE.md`:
  `@~/.claude/rules/production-readiness.md`
- **Audit evidence hooks** — register in `~/.claude/settings.json` so `/audit` reports
  are blocked unless every finding has a `path:line` citation and the format is valid:
  - `PreToolUse` → `python ~/.claude/hooks/pre-audit-evidence-check.py` (matcher: Write on `audit-report*.md`)
  - `PostToolUse` → `python ~/.claude/hooks/post-audit-format-check.py`
  Hooks are optional — `/audit` runs without them, just unenforced.

---

## Repo layout

```
skills/        22 skills: audit-orchestrator, audit-method, audit-hard-stops,
               audit-tambon-hunt, audit-blind-spots, audit-decisions,
               audit-fix-generator, audit-loop, audit-domain-01..13, vibe-to-prod
agents/        audit-runner, audit-domain-runner (isolated-context subagents)
commands/      /audit, /vibe-to-prod
context/       the playbook + audit catalogs (rules, report-format, triage,
               hard-stops, tambon-signatures, blind-spots)
rules/         production-readiness.md (optional always-on rule)
hooks/         pre/post audit evidence + format checks (optional)
install.sh / install.ps1
.claude-plugin/  plugin.json, marketplace.json
```

Skills reference the catalogs as `~/.claude/context/<file>`, which is where the
installer places them.

---

## Credits

The production-readiness knowledge — the 13-layer stack, failure modes, thresholds,
and manual tests — is distilled from the **Matt Murphy AI** body of work on taking
vibe-coded apps to production. vibekiller packages that knowledge into runnable
Claude Code skills.

## License

MIT — see [LICENSE](LICENSE).
