export const meta = {
  name: 'audit-remediate',
  description: 'End-to-end production-readiness remediation. Parallel-audits a repo (hard-stops H1-H11, blind-spots B1-B19, tambon, 13 domains), serially remediates findings on an isolated branch with per-fix verification (test + behavior), re-audits, loops until the verdict is green or rounds/budget run out, then opens a PR for human review. Never merges. Never touches main.',
  phases: [
    { title: 'Prep' },
    { title: 'Audit' },
    { title: 'Triage' },
    { title: 'Remediate' },
    { title: 'Re-review' },
    { title: 'Ship' },
  ],
}

// ----- inputs (pass via Workflow args; Date.* is unavailable inside scripts) -----
const A = args || {}
const SCOPE = A.scope || '.'
const STAMP = A.stamp || 'run'            // caller passes a date stamp, e.g. "20260608"
const MAX_ROUNDS = A.maxRounds || 4
const BRANCH = `audit/remediation-${STAMP}`
const MIN_BUDGET = 80_000                 // stop remediating below this many output tokens

// ----- structured-output schemas -----
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, domain: { type: 'string' },
          severity: { type: 'string' }, exploitability: { type: 'string' },
          hardStop: { type: 'string' }, blindSpot: { type: 'string' },
          file: { type: 'string' }, line: { type: 'number' },
          title: { type: 'string' }, fix: { type: 'string' },
          verifyCmd: { type: 'string' }, humanOnly: { type: 'boolean' },
        },
        required: ['id', 'severity', 'title'],
      },
    },
  },
  required: ['findings'],
}
const FIX = {
  type: 'object',
  properties: {
    id: { type: 'string' }, applied: { type: 'boolean' }, verified: { type: 'boolean' },
    committed: { type: 'boolean' }, commit: { type: 'string' },
    blocked: { type: 'boolean' }, blockedReason: { type: 'string' }, note: { type: 'string' },
  },
  required: ['id', 'applied', 'verified', 'committed'],
}

// ----- deterministic severity ordering + verdict (no model judgment) -----
function sevKey(f) {
  if (f.hardStop && f.hardStop !== '—' && f.hardStop !== '') return 0
  if ((f.exploitability || '').toUpperCase() === 'EXPLOITABLE-NOW') return 1
  const s = (f.severity || '').toLowerCase()
  return s === 'critical' ? 2 : s === 'high' ? 3 : s === 'medium' ? 4 : 5
}
function isGreen(report) {
  const open = (report.findings || []).filter(f => !f.humanOnly)
  const hard = open.some(f => f.hardStop && f.hardStop !== '—' && f.hardStop !== '')
  const expl = open.some(f => (f.exploitability || '').toUpperCase() === 'EXPLOITABLE-NOW')
  const crit = open.filter(f => (f.severity || '').toLowerCase() === 'critical').length
  const high = open.filter(f => (f.severity || '').toLowerCase() === 'high').length
  return !hard && !expl && crit === 0 && high === 0
}
function dedupe(results) {
  const seen = new Set(); const out = []
  for (const r of results) for (const f of (r.findings || [])) {
    const k = `${f.file}:${f.line}:${(f.title || '').slice(0, 40)}`
    if (!seen.has(k)) { seen.add(k); out.push(f) }
  }
  return out
}

// ----- audit fan-out (read-only; safe to parallelize) -----
const WALKERS = [
  ['hard-stops', 'Use the audit-hard-stops skill to walk H1-H11 against the scope. Read ~/.claude/context/audit-hard-stops.md. Return each FOUND hard stop as a finding (hardStop = the H-id, severity "critical").'],
  ['tambon', 'Use the audit-tambon-hunt skill against the scope. Return confirmed signature occurrences on critical paths (auth/payments/deletes) as findings.'],
  ['blind-spots', 'Use the audit-blind-spots skill to walk B1-B19 against the scope. Return PRESENT findings with blindSpot = the B-id and the routed domain.'],
]
const DOMAINS = Array.from({ length: 13 }, (_, i) => String(i + 1).padStart(2, '0'))

function auditThunks(label, branchNote) {
  return [
    ...WALKERS.map(([k, p]) => () => agent(
      `${p}\nSCOPE=${SCOPE}. ${branchNote} Read-only. Cite file:line for every finding (R1/R2 — quote before cite).`,
      { label: `${label}:${k}`, phase: label === 'audit' ? 'Audit' : 'Re-review', schema: FINDINGS })),
    ...DOMAINS.map(d => () => agent(
      `Use the audit-domain-${d} skill (audit-domain-${d}-*). Audit ONLY your domain against SCOPE=${SCOPE}. ${branchNote} Read ~/.claude/context/audit-rules.md first. Return findings as the schema with file:line evidence (R1/R2). Read-only.`,
      { label: `${label}:d${d}`, phase: label === 'audit' ? 'Audit' : 'Re-review', schema: FINDINGS })),
  ]
}

// ========================= run =========================

// --- Prep: isolated branch + detect commands ---
phase('Prep')
await agent(
  `In this repo: confirm the git working tree is clean (if not, stop and report — do not stash silently). ` +
  `Create and check out branch "${BRANCH}" off the current branch. Detect the test command and the build command ` +
  `(read package.json / pyproject.toml / Makefile / CI config). Report: branch created, test cmd, build cmd. Modify NO source.`,
  { label: 'prep', phase: 'Prep' })

// --- Audit (parallel) ---
phase('Audit')
const baseResults = (await parallel(auditThunks('audit', ''))).filter(Boolean)

// --- Triage (deterministic) ---
phase('Triage')
let findings = dedupe(baseResults).sort((a, b) => sevKey(a) - sevKey(b))
let report = { findings }
log(`Baseline: ${findings.length} findings, green=${isGreen(report)}`)
if (findings.length === 0) {
  return { status: 'clean', rounds: 0, remaining: 0, blocked: 0, branch: null }
}

// --- Remediate (serial, verified) + Re-review (parallel) loop ---
let round = 0
while (!isGreen(report) && round < MAX_ROUNDS && budget.remaining() > MIN_BUDGET) {
  round++
  phase(`Remediate`)
  const open = (report.findings || [])
    .filter(f => !f.humanOnly && !f.blocked)
    .sort((a, b) => sevKey(a) - sevKey(b))
  for (const f of open) {
    if (budget.remaining() < MIN_BUDGET) { log('budget low — stopping remediation early'); break }
    await agent(
      `On branch ${BRANCH}, remediate finding ${f.id} — "${f.title}" at ${f.file || '?'}:${f.line || '?'}.\n` +
      `Recommended fix: ${f.fix || '(derive from the finding and the domain skill)'}\n` +
      `RULES:\n` +
      `- Minimal diff. Hardening only — do NOT change product behavior beyond the fix.\n` +
      `- ADD or fix a test that encodes WHY this matters (anchored to the requirement, not the implementation).\n` +
      `- Run the FULL test suite AND this verification: ${f.verifyCmd || '(targeted re-check of the fixed path)'}.\n` +
      `- Only if green, commit atomically: "fix: ${f.id} <one-line summary>". Set verified+committed true.\n` +
      `- If you cannot verify, REVERT your changes and set blocked=true with blockedReason.\n` +
      `- NEVER weaken or delete a test to make it pass — that is the exact H9/B13 failure mode this system exists to catch. If tempted, set blocked=true.\n` +
      `- If this is human-only (rotate a leaked/exposed key, enable RLS in a dashboard, buy a paid tier, run a data migration), do NOT attempt it: set blocked=true and start blockedReason with "HUMAN: ".`,
      { label: `fix:${f.id}`, phase: 'Remediate', schema: FIX })
  }

  phase(`Re-review`)
  const reResults = (await parallel(auditThunks('re', `Re-audit AFTER fixes on branch ${BRANCH}.`))).filter(Boolean)
  let next = dedupe(reResults)
  // carry forward human-only / blocked items that re-review won't reproduce
  const carried = (report.findings || []).filter(f => f.humanOnly || f.blocked)
  const nextKeys = new Set(next.map(f => `${f.file}:${f.line}:${(f.title || '').slice(0, 40)}`))
  for (const c of carried) {
    const k = `${c.file}:${c.line}:${(c.title || '').slice(0, 40)}`
    if (!nextKeys.has(k)) next.push(c)
  }
  next.sort((a, b) => sevKey(a) - sevKey(b))
  report = { findings: next }
  log(`Round ${round}: ${next.length} findings remain, green=${isGreen(report)}`)
}

// --- Ship: verify branch, open PR (never merge) ---
phase('Ship')
const blocked = (report.findings || []).filter(f => f.humanOnly || f.blocked)
const ship = await agent(
  `On branch ${BRANCH}: run the full test suite and the build, capture output. ` +
  `Push the branch and open a PR (use gh if available; otherwise push and print the exact PR-create command). ` +
  `PR title: "Audit remediation (${STAMP})". PR body must include: a per-severity summary of fixes applied; ` +
  `the final state (${isGreen(report) ? 'verdict 🟢 ACCEPTABLE' : `${(report.findings || []).length} findings still open`}); ` +
  `and a "HUMAN ACTION REQUIRED" checklist for these blocked items: ${JSON.stringify(blocked.map(b => ({ id: b.id, reason: b.blockedReason || 'human action' })))}. ` +
  `Do NOT merge. Return the PR url (or the branch name + push command).`,
  { label: 'open-pr', phase: 'Ship' })

return {
  status: isGreen(report) ? 'green' : (round >= MAX_ROUNDS ? 'rounds-exhausted' : (budget.remaining() <= MIN_BUDGET ? 'budget-exhausted' : 'partial')),
  rounds: round,
  remaining: (report.findings || []).length,
  blocked: blocked.length,
  branch: BRANCH,
  ship,
}
