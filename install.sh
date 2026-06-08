#!/usr/bin/env bash
# vibekiller installer — copies the toolkit into your Claude Code config.
# Safe to re-run (overwrites the toolkit's own files; touches nothing else).
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"

echo "Installing vibekiller into: $DEST"
echo ""

for d in skills agents commands context rules hooks; do
  if [ -d "$SRC/$d" ]; then
    mkdir -p "$DEST/$d"
    cp -R "$SRC/$d/." "$DEST/$d/"
    echo "  copied $d/"
  fi
done

cat <<'EOF'

Done. Restart Claude Code so it picks up the new skills and commands.

  /vibe-to-prod   fast 13-layer production-readiness self-check
  /audit          full multi-domain technical due-diligence audit

Optional wiring (the install does NOT edit your config for you):

  1. Always-on rule — add this line to your ~/.claude/CLAUDE.md:
       @~/.claude/rules/production-readiness.md

  2. Audit evidence hooks — enforce path:line citations + report format.
     Add to ~/.claude/settings.json (matcher: Write on audit-report*.md):
       PreToolUse  -> python ~/.claude/hooks/pre-audit-evidence-check.py
       PostToolUse -> python ~/.claude/hooks/post-audit-format-check.py
     (Hooks are optional; /audit works without them, just unenforced.)

See README.md for details.
EOF
