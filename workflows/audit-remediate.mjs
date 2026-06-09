export const meta = {
  name: 'audit-remediate',
  description: 'End-to-end production-readiness remediation. Parallel-audits a repo (hard-stops H1-H11, blind-spots B1-B19, tambon, 13 domains), serially remediates findings on a dedicated isolated branch (each fix HARD-ASSERTS it is on that branch before committing) with cheap targeted per-fix tests, runs one full-suite gate, re-audits, loops until the verdict is green or rounds/budget run out, then opens a PR for human review. Never merges. Never commits to the branch that was checked out at launch.',
  phases: [
    { title: 'Prep' },
    { title: 'Audit' },
    { title: 'Triage' },
    { title: 'Remediate' },
    { title: 'Re-review' },
    { title: 'Verify' },
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

// Hard branch-isolation guard prepended to EVERY agent that may commit.
// Earlier versions only *said* "on branch X" and trusted a prior agent's
// checkout to persist; when Prep's checkout silently failed, fixers committed
// onto the launch branch. Now every committing agent re-asserts the branch.
const BRANCH_GUARD =
  `MANDATORY FIRST STEP — branch isolation. Run \`git rev-parse --abbrev-ref HEAD\`. ` +
  `If it is not exactly "${BRANCH}", get onto it: \`git checkout ${BRANCH}\`, or create it ` +
  `(\`git checkout -b ${BRANCH}\`) if it does not exist yet. Re-run \`git rev-parse --abbrev-ref HEAD\` ` +
  `and confirm it prints exactly "${BRANCH}". If you cannot end up on "${BRANCH}", STOP IMMEDIATELY: ` +
  `make NO commits, set blocked=true and blockedReason="branch-isolation-failed". ` +
  `NEVER commit on any branch other than "${BRANCH}".\n`

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
  `In this repo: confirm the git working tree is clean (\`git status --porcelain\` empty). If NOT clean, STOP and report — do not stash or commit silently. ` +
  `Record the current branch name (the LAUNCH branch — the workflow must never commit to it). ` +
  `Then create and check out a NEW branch named exactly "${BRANCH}" off the launch branch: \`git checkout -b ${BRANCH}\`. ` +
  `VERIFY: run \`git rev-parse --abbrev-ref HEAD\` and confirm it prints exactly "${BRANCH}" — if it does not, STOP and report failure (do not proceed). ` +
  `Detect the test command and the build command (read package.json / pyproject.toml / Makefile / CI config). ` +
  `Report: launch branch, "${BRANCH}" created+verified (quote the rev-parse output), test cmd, build cmd. Modify NO source.`,
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
      BRANCH_GUARD +
      `Remediate finding ${f.id} — "${f.title}" at ${f.file || '?'}:${f.line || '?'}.\n` +
      `Recommended fix: ${f.fix || '(derive from the finding and the domain skill)'}\n` +
      `RULES:\n` +
      `- Minimal diff. Hardening only — do NOT change product behavior beyond the fix.\n` +
      `- ADD or fix a test that encodes WHY this matters (anchored to the requirement, not the implementation).\n` +
      `- Verify with TARGETED tests only — run just the test file(s)/path that cover the code you changed, plus this check if given: ${f.verifyCmd || '(targeted re-check of the fixed path)'}. Do NOT run the whole test suite here (a single full-suite gate runs once in the Verify phase).\n` +
      `- Only if the targeted tests pass, commit atomically on "${BRANCH}": "fix: ${f.id} <one-line summary>". Set verified+committed true and put the commit sha in "commit".\n` +
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

// --- Verify: ONE full-suite + build gate (per-fix used cheap targeted tests) ---
phase('Verify')
const VERIFY = {
  type: 'object',
  properties: { passed: { type: 'boolean' }, summary: { type: 'string' }, failing: { type: 'string' } },
  required: ['passed', 'summary'],
}
const verify = (await agent(
  BRANCH_GUARD +
  `Run the FULL test suite AND the build ONCE on "${BRANCH}", capturing output. This is the single full-suite gate for the whole remediation round (the per-fix steps used cheap targeted tests). ` +
  `Set passed=true only if BOTH the full suite and the build are green. If anything is red, set passed=false, put the failing suite/step in "failing" and a one-line "summary". ` +
  `Do NOT fix anything and do NOT weaken/skip tests here — only run and report.`,
  { label: 'verify', phase: 'Verify', schema: VERIFY })) || { passed: false, summary: 'verify agent returned nothing' }

// --- Ship: open PR (never merge) ---
phase('Ship')
const blocked = (report.findings || []).filter(f => f.humanOnly || f.blocked)
const ship = await agent(
  BRANCH_GUARD +
  `The full-suite gate already ran (passed=${verify.passed}; ${verify.summary}). Do NOT re-run the whole suite. ` +
  `Push "${BRANCH}" and open a PR (use gh if available; otherwise push and print the exact PR-create command). ` +
  `PR title: "Audit remediation (${STAMP})". PR body must include: a per-severity summary of fixes applied; ` +
  `the full-suite gate result (${verify.passed ? 'PASSED' : 'FAILED — ' + (verify.summary || 'see failing')}${verify.passed ? '' : ' — mark the PR DO-NOT-MERGE until fixed'}); ` +
  `the final verdict (${isGreen(report) ? '🟢 ACCEPTABLE' : `${(report.findings || []).length} findings still open`}); ` +
  `and a "HUMAN ACTION REQUIRED" checklist for these blocked items: ${JSON.stringify(blocked.map(b => ({ id: b.id, reason: b.blockedReason || 'human action' })))}. ` +
  `Confirm the PR base is the launch branch and the head is "${BRANCH}". Do NOT merge. Return the PR url (or the branch name + push command).`,
  { label: 'open-pr', phase: 'Ship' })

return {
  status: !verify.passed ? 'tests-failing' : isGreen(report) ? 'green' : (round >= MAX_ROUNDS ? 'rounds-exhausted' : (budget.remaining() <= MIN_BUDGET ? 'budget-exhausted' : 'partial')),
  rounds: round,
  remaining: (report.findings || []).length,
  blocked: blocked.length,
  fullSuitePassed: verify.passed,
  branch: BRANCH,
  ship,
}
