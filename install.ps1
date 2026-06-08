# vibekiller installer (Windows / PowerShell)
# Copies the toolkit into your Claude Code config. Safe to re-run.
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = if ($env:CLAUDE_HOME) { $env:CLAUDE_HOME } else { Join-Path $HOME '.claude' }

Write-Host "Installing vibekiller into: $dest`n"

foreach ($d in 'skills', 'agents', 'commands', 'context', 'rules', 'hooks') {
  $from = Join-Path $src $d
  if (Test-Path $from) {
    $to = Join-Path $dest $d
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    Copy-Item -Path (Join-Path $from '*') -Destination $to -Recurse -Force
    Write-Host "  copied $d/"
  }
}

Write-Host @'

Done. Restart Claude Code so it picks up the new skills and commands.

  /vibe-to-prod   fast 13-layer production-readiness self-check
  /audit          full multi-domain technical due-diligence audit

Optional wiring (the install does NOT edit your config for you):

  1. Always-on rule - add this line to your ~/.claude/CLAUDE.md:
       @~/.claude/rules/production-readiness.md

  2. Audit evidence hooks - enforce path:line citations + report format.
     Add to ~/.claude/settings.json (matcher: Write on audit-report*.md):
       PreToolUse  -> python ~/.claude/hooks/pre-audit-evidence-check.py
       PostToolUse -> python ~/.claude/hooks/post-audit-format-check.py
     (Hooks are optional; /audit works without them, just unenforced.)

See README.md for details.
'@
