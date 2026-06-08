---
description: Fast 13-layer production-readiness self-check on the current project. Lighter than /audit — walks the layers, runs cheap detections + manual tests, and emits a PASS/GAP scorecard with a prioritized "finish the boring 20%" list.
allowed-tools: Read, Grep, Glob, Bash, Skill
---

# /vibe-to-prod — Production-readiness self-check

Invoke the `vibe-to-prod` skill against this project:

```
Skill("vibe-to-prod")
```

Then follow its instructions. It reads the playbook at
`~/.claude/context/production-readiness-playbook.md`, walks the 13 layers,
runs cheap grep-based detections, prompts the manual auth/cost tests, and
returns a per-layer scorecard.

This is the lightweight path. For an exhaustive, evidence-cited,
acquisition-grade report, run `/audit` instead.

If the skill can't be loaded, the toolkit isn't installed — run the
vibekiller `install` script (or add the plugin) and restart Claude Code.
