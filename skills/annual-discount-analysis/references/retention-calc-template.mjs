// TEMPLATE — annual-discount analysis (see ../SKILL.md)
// Copy to the scratchpad, replace COHORTS + PARAMS with the company's real data, run: node retention-calc-template.mjs
// The data below is a SYNTHETIC worked example (typical SMB-SaaS decay shape) — replace it entirely.
// Conventions: ret[0] = % of cohort MRR retained 1 quarter after acquisition; a cohort's age = ret.length
// (its last value is its CURRENT retention). Payments modeled monthly, paid at month start.

// ── PARAMS ──────────────────────────────────────────────────────────────────
const DISCOUNTS = [0.10, 0.15, 0.20, 0.25, 0.30]; // depths to compare
const OFFER_DISCOUNT = 0.30;                      // the proposed offer
const SEGMENT_SHARE = 1.0;                        // share of cohort MRR actually in the target segment (<1 if e.g. only legacy-product users are eligible)
const UNSHOWN_SEGMENT_MRR = 0;                    // segment MRR in older cohorts missing from the table (0 if none / unknown — then say so in the output)
const TAIL_FACTOR = 0.95;                         // survivor quarterly retention beyond observed steps (sensitivity: 0.92–0.97)
const TAKE_RATES = [0.10, 0.20, 0.30];
const CHURNER_SHARES = [0.05, 0.10, 0.20, 1 / 3]; // share of takers who'd truly churn within 12 months

// ── DATA: target-segment cohorts (value = new MRR in the acquisition quarter; ret = % retained per quarter) ──
const cohorts = [
  { q: 'YR1-Q1', value: 40000, ret: [60, 48, 42, 37, 34, 31, 29, 27, 25, 24, 23] },
  { q: 'YR1-Q2', value: 42000, ret: [58, 46, 40, 35, 32, 30, 28, 26, 24, 23] },
  { q: 'YR1-Q3', value: 45000, ret: [59, 47, 41, 36, 33, 31, 29, 27, 25] },
  { q: 'YR1-Q4', value: 43000, ret: [57, 45, 39, 35, 32, 30, 28, 26] },
  { q: 'YR2-Q1', value: 46000, ret: [58, 46, 40, 35, 32, 30, 28] },
  { q: 'YR2-Q2', value: 44000, ret: [56, 44, 39, 34, 31, 29] },
  { q: 'YR2-Q3', value: 48000, ret: [57, 45, 39, 35, 32] },
  { q: 'YR2-Q4', value: 45000, ret: [55, 44, 38, 34] },
];
// All cohorts incl. those outside the segment — ONLY for validating the transcription:
const allCohorts = [
  ...cohorts,
  { q: 'YR3-Q1', value: 47000, ret: [54, 43, 37] },
  { q: 'YR3-Q2', value: 46000, ret: [53, 42] },
  { q: 'YR3-Q3', value: 49000, ret: [52] },
];
// Replace with the weighted-average row reported by the source table (used only to catch transcription errors):
const REPORTED_WEIGHTED_AVG = [56.2, 45.2, 39.6, 35.1, 32.1, 30.2, 28.4, 26.5, 24.7, 23.5, 23.0];

// ── 1. Validate transcription against the reported weighted-average row ─────
console.log('=== 1. Transcription validation ===');
for (let col = 0; col < REPORTED_WEIGHTED_AVG.length; col++) {
  let num = 0, den = 0;
  for (const c of allCohorts) if (c.ret.length > col) { num += c.value * c.ret[col]; den += c.value; }
  const wa = num / den;
  const ok = Math.abs(wa - REPORTED_WEIGHTED_AVG[col]) <= 1;
  console.log(`col ${col + 1}: computed ${wa.toFixed(1)}%  reported ${REPORTED_WEIGHTED_AVG[col]}%  ${ok ? 'OK' : 'MISMATCH — fix data before proceeding'}`);
}

// ── 2. Survivor forward churn: MRR-weighted transition factor per age step ──
const stepFactors = {};
for (const c of cohorts) {
  for (let i = 1; i < c.ret.length; i++) {
    (stepFactors[i] ??= []).push({ f: c.ret[i] / c.ret[i - 1], w: c.value * c.ret[i - 1] / 100 });
  }
}
const f01 = cohorts.reduce((s, c) => s + c.value * c.ret[0], 0) / cohorts.reduce((s, c) => s + c.value, 0) / 100;
function stepF(k) { // survivor retention factor for the transition age k -> k+1 (k=0: acquisition -> q1)
  if (k === 0) return f01;
  const obs = stepFactors[k];
  if (!obs?.length) return TAIL_FACTOR;
  return obs.reduce((s, o) => s + o.f * o.w, 0) / obs.reduce((s, o) => s + o.w, 0);
}
console.log('\n=== 2. Survivor quarterly retention by age step (MRR-weighted) ===');
const maxStep = Math.max(...Object.keys(stepFactors).map(Number));
for (let k = 1; k <= maxStep; k++) {
  console.log(`step ${k}->${k + 1}: ${(stepF(k) * 100).toFixed(1)}%  (churn ${((1 - stepF(k)) * 100).toFixed(1)}%/q, n=${stepFactors[k].length})`);
}

// ── 3. Break-even churn per discount depth (12-month horizon) ───────────────
function solveBreakEvenMonthly(targetMonths) {
  let lo = 0.5, hi = 0.999999;
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    ((1 - m ** 12) / (1 - m) > targetMonths) ? hi = m : lo = m;
  }
  return (lo + hi) / 2;
}
console.log('\n=== 3. Break-even churn by discount depth ===');
for (const d of DISCOUNTS) {
  const m = solveBreakEvenMonthly(12 * (1 - d));
  console.log(`discount ${(d * 100).toFixed(0)}%: monthly churn ${((1 - m) * 100).toFixed(1)}% => quarterly ${((1 - m ** 3) * 100).toFixed(1)}%`);
}

// ── 4. Forward 12/24-month value by age (geometric monthly interpolation) ───
function forwardValue(age, months) {
  let v = 0, s = 1, j = 0;
  for (let q = 0; j < months; q++) {
    const gm = stepF(age + q) ** (1 / 3);
    for (let k = 0; k < 3 && j < months; k++, j++) { v += s; s *= gm; }
  }
  return { v, endSurvival: s }; // v in months of current MRR; endSurvival = S(months)
}

const LOCK = 12 * (1 - OFFER_DISCOUNT);
console.log(`\n=== 4. Per-cohort forward economics (lock = ${LOCK.toFixed(1)} months at -${OFFER_DISCOUNT * 100}%) ===`);
console.log('cohort | age | currentRet | segment MRR | V12 | fwd-NRR | delta vs lock');
let totalMRR = 0, totalV12w = 0, totalS12w = 0;
const perCohort = [];
for (const c of cohorts) {
  const age = c.ret.length;
  const mrr = c.value * c.ret[age - 1] / 100 * SEGMENT_SHARE;
  const { v: V12, endSurvival: S12 } = forwardValue(age, 12);
  totalMRR += mrr; totalV12w += V12 * mrr; totalS12w += S12 * mrr;
  perCohort.push({ q: c.q, age, mrr, V12 });
  console.log(`${c.q} | ${age} | ${c.ret[age - 1]}% | ${Math.round(mrr).toLocaleString('en')} | ${V12.toFixed(2)} | ${(V12 / 12 * 100).toFixed(0)}% | ${(LOCK - V12).toFixed(2)} mo`);
}
const wV12 = totalV12w / totalMRR, wS12 = totalS12w / totalMRR;
console.log(`Segment MRR (visible cohorts): ${Math.round(totalMRR).toLocaleString('en')} | weighted V12 ${wV12.toFixed(2)} mo (${(wV12 / 12 * 100).toFixed(0)}% fwd-NRR)`);

// ── 5. Adverse selection — CORRECTED accounting ─────────────────────────────
// Loyal takers are by definition 12-month survivors: counterfactual = 12.0 months (NOT blended V12).
// Would-be churner counterfactual implied by V12 = S12*12 + (1-S12)*V_churn.
const V_CHURN = (wV12 - wS12 * 12) / (1 - wS12);
const phiStar = (12 - LOCK) / ((12 - LOCK) + (LOCK - V_CHURN));
console.log(`\n=== 5. Adverse selection ===`);
console.log(`implied 12-mo survivor share S12: ${(wS12 * 100).toFixed(1)}% | would-be churner counterfactual V_churn: ${V_CHURN.toFixed(2)} mo`);
console.log(`loss per loyal taker: ${(12 - LOCK).toFixed(1)} mo | gain per saved churner: ${(LOCK - V_CHURN).toFixed(1)} mo`);
console.log(`break-even churner share of takers phi*: ${(phiStar * 100).toFixed(0)}%  (realistic for proactive prepay offers: <10-20%)`);

// ── 6. Aggregate year-1 grid (currency/yr) on the full segment ──────────────
const fullSegmentMRR = totalMRR + UNSHOWN_SEGMENT_MRR;
console.log(`\n=== 6. Aggregate year-1 net effect, full segment (~${Math.round(fullSegmentMRR / 1000)}k MRR) ===`);
console.log('take-rate \\ churner-share | ' + CHURNER_SHARES.map(p => `${(p * 100).toFixed(0)}%`).join(' | '));
for (const t of TAKE_RATES) {
  const row = CHURNER_SHARES.map(phi => {
    const deltaPerTaker = phi * (LOCK - V_CHURN) - (1 - phi) * (12 - LOCK); // months of taker MRR
    return `${Math.round(fullSegmentMRR * t * deltaPerTaker / 1000)}k`;
  });
  console.log(`${(t * 100).toFixed(0)}% | ${row.join(' | ')}`);
}

// ── 7. Sweet spot by cohort age (segmentation) ──────────────────────────────
console.log('\n=== 7. Sweet spot: V12 by cohort age vs each lock ===');
console.log('age(q) | V12 | ' + DISCOUNTS.map(d => `vs -${d * 100}% (${(12 * (1 - d)).toFixed(1)})`).join(' | '));
for (let a = 0; a <= 11; a++) {
  const { v } = forwardValue(a, 12);
  console.log(`${a} | ${v.toFixed(2)} | ` + DISCOUNTS.map(d => (12 * (1 - d) - v > 0 ? '+' : '') + (12 * (1 - d) - v).toFixed(2)).join(' | '));
}
console.log('Positive = discount pays at that age. NB: next-quarter churn is NOT the test — the lock covers 12 months.');

// ── 8. 24-month view (discount persists at renewal) ─────────────────────────
console.log('\n=== 8. 24-month view ===');
const wV24 = perCohort.reduce((s, pc) => s + forwardValue(pc.age, 24).v * pc.mrr, 0) / totalMRR;
for (const rho of [0.6, 0.7, 0.8]) {
  console.log(`annual renewal ${rho * 100}%: annual 24-mo = ${(LOCK * (1 + rho)).toFixed(1)} mo vs monthly-stay = ${wV24.toFixed(1)} mo`);
}

// ── 9. Tail-factor sensitivity ──────────────────────────────────────────────
console.log('\n=== 9. Tail sensitivity (pure-tail V12 under 0.92/0.95/0.97) ===');
for (const tf of [0.92, 0.95, 0.97]) {
  let v = 0, s = 1;
  const g = tf ** (1 / 3);
  for (let j = 0; j < 12; j++) { v += s; s *= g; }
  console.log(`tail ${tf}: pure-tail V12 = ${v.toFixed(2)} mo`);
}
