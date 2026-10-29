// TEMPLATE — annual-discount analysis (see ../SKILL.md)
// Copy to the scratchpad, replace COHORTS + PARAMS with the company's real data, run: node retention-calc-template.mjs
// The data below is a SYNTHETIC worked example (typical SMB-SaaS decay shape) — replace it entirely.
// Conventions: ret[0] = % of cohort MRR retained 1 quarter after acquisition; a cohort's age = ret.length
// (its last value is its CURRENT retention). Payments modeled monthly, paid at month start.
// From section 4 on, all economics run on the AUDIENCE curve: monthly payers (de-blended when W_ANNUAL > 0).

// ── PARAMS ──────────────────────────────────────────────────────────────────
const DISCOUNTS = [0.10, 0.15, 0.20, 0.25, 0.30]; // depths to compare
const OFFER_DISCOUNT = 0.30;                      // the proposed offer
const EXISTING_DISCOUNT = 0.20;                   // annual discount already on the shelf (null if none)
const SEGMENT_SHARE = 1.0;                        // share of cohort MRR actually in the target segment (<1 if e.g. only legacy-product users are eligible)
const UNSHOWN_SEGMENT_MRR = 0;                    // segment MRR in older cohorts missing from the table (0 if none / unknown — then say so in the output)
const UNSHOWN_AGE = 12;                           // age (quarters) assigned to UNSHOWN_SEGMENT_MRR in the model grids
const TAIL_FACTOR = 0.95;                         // survivor quarterly retention beyond observed steps (sensitivity: 0.92–0.97)
const TAKE_UP = [0.05, 0.10, 0.20];               // takers' share of segment MRR
const W_ANNUAL = 1 / 3;                           // annual-payer share of the table's MRR (0 = table is pure monthly)
const ANNUAL_STEP_CHURN = (c) => 0.5 * c;         // annual payers' quarterly churn given blended churn c (replace with measured values per age if available)
// Selection model: would-be churners (would leave within 12 months) take the offer at r × the rate of stayers.
// r_low is revealed by annual payers' 12-month non-renewal vs monthly payers' 12-month churn at the same age (odds ratio).
// It is a LOWER bound: annual payers' lower churn also contains the lock/auto-renew effect. r = 1 = no selection.
const ANNUAL_NONRENEWAL = null;                   // annual payers' 12-month non-renewal by age (array, index = age, last value reused) or one number; null -> R_LOW_DEFAULT (flag it)
const R_LOW_DEFAULT = 0.3;                        // only if ANNUAL_NONRENEWAL is null. One SMB-SaaS calibration: ~0.1 signup quarter, 0.25–0.37 age 1–4, 0.5–0.7 older
const ANNUAL_RENEWAL_DEFAULT = 0.8;               // annual payers' renewal rate for section 8, only if ANNUAL_NONRENEWAL is null (benchmark 60–80%; flag it)
const SHOCKS = [[0.02, 6], [0.02, 12], [0.03, 12], [0.05, 12]]; // temporary churn shocks [extra churn per month, months]; [] to skip

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
function stepF(k) { // blended survivor retention factor for the transition age k -> k+1 (k=0: acquisition -> q1)
  if (k === 0) return f01;
  const obs = stepFactors[k];
  if (!obs?.length) return TAIL_FACTOR;
  return obs.reduce((s, o) => s + o.f * o.w, 0) / obs.reduce((s, o) => s + o.w, 0);
}
function stepFM(k) { // monthly-payer factor: c = wA*cA + (1-wA)*cM  =>  cM = (c - wA*cA)/(1-wA)
  const f = stepF(k);
  if (W_ANNUAL <= 0) return f;
  const c = 1 - f, cA = Math.min(ANNUAL_STEP_CHURN(c), c);
  return 1 - Math.min(Math.max((c - W_ANNUAL * cA) / (1 - W_ANNUAL), 0), 0.9);
}
const F = stepFM; // audience curve used from section 4 on
console.log('\n=== 2. Survivor quarterly retention by age step (MRR-weighted) ===');
const maxStep = Math.max(...Object.keys(stepFactors).map(Number));
for (let k = 1; k <= maxStep; k++) {
  console.log(`step ${k}->${k + 1}: blended ${(stepF(k) * 100).toFixed(1)}% (churn ${((1 - stepF(k)) * 100).toFixed(1)}%/q, n=${stepFactors[k].length}) | monthly payers churn ${((1 - F(k)) * 100).toFixed(1)}%/q`);
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

// ── 4. Forward value by age on the audience curve, before selection ─────────
function fwd(age, months = 12, extra = 0, k = 0, f = F) { // monthly steps; optional extra churn for the first k months
  let v = 0, s = 1;
  for (let j = 0; j < months; j++) {
    v += s;
    const base = 1 - f(age + Math.floor(j / 3)) ** (1 / 3);
    s *= 1 - Math.min(base + (j < k ? extra : 0), 0.95);
  }
  return { v, s }; // v in months of current MRR; s = survival after `months`
}

const LOCK = 12 * (1 - OFFER_DISCOUNT);
console.log(`\n=== 4. Per-cohort forward economics, before selection (lock = ${LOCK.toFixed(1)} months at -${OFFER_DISCOUNT * 100}%) ===`);
console.log('cohort | age | currentRet | segment MRR | V12 | fwd-NRR | delta vs lock');
let totalMRR = 0, totalV12w = 0;
const perCohort = [];
for (const c of cohorts) {
  const age = c.ret.length;
  const mrr = c.value * c.ret[age - 1] / 100 * SEGMENT_SHARE * (1 - W_ANNUAL); // monthly payers only
  const { v: V12 } = fwd(age);
  totalMRR += mrr; totalV12w += V12 * mrr;
  perCohort.push({ q: c.q, age, mrr });
  console.log(`${c.q} | ${age} | ${c.ret[age - 1]}% | ${Math.round(mrr).toLocaleString('en')} | ${V12.toFixed(2)} | ${(V12 / 12 * 100).toFixed(0)}% | ${(LOCK - V12).toFixed(2)} mo`);
}
console.log(`Monthly-payer segment MRR (visible cohorts): ${Math.round(totalMRR).toLocaleString('en')} | weighted V12 ${(totalV12w / totalMRR).toFixed(2)} mo`);
console.log('These are averages over everyone still paying = the r = 1 case of section 5. Never derive cut-offs from them.');

// ── 5. Selection model by age ────────────────────────────────────────────────
// Per age: p = 1 - S12 (would leave within 12 months), V_churn = (V12 - S12*12)/(1 - S12).
// Churner share among takers phi = p*r / (p*r + 1 - p). Net per taker = phi*(L - V_churn) - (1 - phi)*(12 - L)  (loyal taker = 12.0).
// r needed = odds(phi*) / odds(p), phi* = (12-L) / ((12-L) + (L - V_churn)). r needed > 1 => loses even with random takers.
const odds = (x) => x / (1 - x);
const phiOf = (p, r) => p * r / (p * r + 1 - p);
const netPerTaker = (L, m, r) => { const phi = phiOf(m.p, r); return phi * (L - m.vch) - (1 - phi) * (12 - L); };
const rNeeded = (L, m) => { if (L <= m.vch) return Infinity; const ps = (12 - L) / ((12 - L) + (L - m.vch)); return odds(ps) / odds(m.p); };
function ageModel(age, extra = 0, k = 0) { const { v, s } = fwd(age, 12, extra, k); return { v, p: 1 - s, vch: (v - s * 12) / (1 - s) }; }
function rLow(age) {
  if (ANNUAL_NONRENEWAL == null) return R_LOW_DEFAULT;
  const pa = Array.isArray(ANNUAL_NONRENEWAL) ? ANNUAL_NONRENEWAL[Math.min(age, ANNUAL_NONRENEWAL.length - 1)] : ANNUAL_NONRENEWAL;
  return Math.min(odds(pa) / odds(ageModel(age).p), 1);
}
const rMid = (age) => Math.sqrt(rLow(age)); // central case: geometric midpoint of [r_low, 1]
const verdict = (rn, age) => rn <= rLow(age) ? 'pays (any plausible selection)' : rn <= rMid(age) ? 'pays (central)' : rn <= 1 ? 'only with weak selection' : 'loses even without selection';
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const depthsShown = [...new Set([EXISTING_DISCOUNT, OFFER_DISCOUNT].filter(d => d != null))];

console.log(`\n=== 5. Selection model by age${ANNUAL_NONRENEWAL == null ? ` — r_low = DEFAULT ${R_LOW_DEFAULT} (no annual renewal data: FLAG IN OUTPUT)` : ''} ===`);
for (let a = 0; a <= 11; a++) {
  const m = ageModel(a);
  const cells = depthsShown.map(d => { const L = 12 * (1 - d), rn = rNeeded(L, m); return `-${d * 100}%: r needed ${rn === Infinity ? 'inf' : rn.toFixed(2)}, central ${fmt(netPerTaker(L, m, rMid(a)))} mo/taker, ${verdict(rn, a)}`; });
  console.log(`age ${a}: would leave ${(m.p * 100).toFixed(0)}% | r ${rLow(a).toFixed(2)}–1 (central ${rMid(a).toFixed(2)}) | ${cells.join(' || ')}`);
}

// ── 6. Aggregate year-1 grid on the full segment, model-based ────────────────
const segRows = [...perCohort.map(pc => ({ age: pc.age, mrr: pc.mrr })), ...(UNSHOWN_SEGMENT_MRR > 0 ? [{ age: UNSHOWN_AGE, mrr: UNSHOWN_SEGMENT_MRR * (1 - W_ANNUAL) }] : [])];
const fullSegmentMRR = segRows.reduce((s, r) => s + r.mrr, 0);
const R_SCEN = { 'own-data bound': (a) => rLow(a), 'central': (a) => rMid(a), 'none (r=1)': () => 1 };
function blanket(t, rf, d = OFFER_DISCOUNT, extra = 0, k = 0) { // takers hold t of segment MRR; rf(age, extra, k) -> r
  const L = 12 * (1 - d);
  const rows = segRows.map(r => ({ ...r, m: ageModel(r.age, extra, k), r: rf(r.age, extra, k) }));
  const share = rows.reduce((s, x) => s + x.mrr * ((1 - x.m.p) + x.m.p * x.r), 0);
  const scale = t * fullSegmentMRR / share;
  const total = rows.reduce((s, x) => s + x.mrr * scale * ((1 - x.m.p) + x.m.p * x.r) * netPerTaker(L, x.m, x.r), 0);
  return { total, phi: rows.reduce((s, x) => s + x.mrr * x.m.p * x.r, 0) / share };
}
console.log(`\n=== 6. Year-1 net effect, -${OFFER_DISCOUNT * 100}% to the full monthly-payer segment (~${Math.round(fullSegmentMRR / 1000)}k MRR${UNSHOWN_SEGMENT_MRR ? '' : ', visible cohorts only'}), currency k/yr ===`);
console.log('takers\' MRR share \\ selection | ' + Object.keys(R_SCEN).join(' | '));
for (const t of TAKE_UP) console.log(`${t * 100}% | ` + Object.values(R_SCEN).map(rf => Math.round(blanket(t, rf).total / 1000)).join(' | '));
const phiStar = segRows.reduce((s, r) => s + r.mrr * (12 - LOCK), 0) / segRows.reduce((s, r) => s + r.mrr * ((12 - LOCK) + (LOCK - ageModel(r.age).vch)), 0);
console.log(`would-be churners among takers: needed ${(phiStar * 100).toFixed(0)}% | ` + Object.entries(R_SCEN).map(([n, rf]) => `${n} ${(blanket(0.1, rf).phi * 100).toFixed(0)}%`).join(' | '));

// ── 7. Segmentation rule by age (selection-adjusted) ─────────────────────────
console.log('\n=== 7. Segmentation: ages where each depth pays, selection included ===');
for (const d of DISCOUNTS) {
  const L = 12 * (1 - d), any = [], central = [];
  for (let a = 0; a <= 11; a++) { const rn = rNeeded(L, ageModel(a)); if (rn <= rLow(a)) any.push(a); else if (rn <= rMid(a)) central.push(a); }
  console.log(`-${d * 100}%: pays under any plausible selection at ages [${any.join(',') || '-'}] | pays in the central case at ages [${central.join(',') || '-'}]`);
}
if (EXISTING_DISCOUNT != null && EXISTING_DISCOUNT !== OFFER_DISCOUNT) {
  for (let a = 0; a <= 2; a++) {
    const m = ageModel(a), nO = netPerTaker(LOCK, m, rMid(a)), nE = netPerTaker(12 * (1 - EXISTING_DISCOUNT), m, rMid(a));
    console.log(`age ${a}, central: offer ${fmt(nO)} vs existing ${fmt(nE)} mo/taker${nO > 0 && nE > nO ? ` -> offer needs ${(nE / nO).toFixed(1)}x the takers to beat the existing plan` : ''}`);
  }
}
console.log('A cancel-flow offer has would-be churners ~= 100% of its audience, so r does not apply there (but see SKILL.md pitfall 14).');

// ── 8. Beyond year one: 24-month value with a causal lock-in share tau ──────
// tau = share of the annual-vs-monthly retention gap caused by the contract (one cancel decision a year, renewal by default).
// tau = 0: pure selection (r = r_low, nobody's year-2 behaviour changes); tau = 1: takers random (r = 1), renewing like today's annual payers.
// r = r_low^(1 - tau), so tau = 0.5 is the central case of section 5. Year 2 in full-year equivalents:
//   counterfactual E_cf = (1 - phi) * V12(age + 4) / 12  (would-be churners pay nothing; ignoring their reactivations favours the offer)
//   annual takers  E_ann = (1 - tau) * E_cf + tau * annual renewal, paying 12 * q2 per year (q2 = price factor at renewal)
// Renewal is taken at today's annual rate even after a price step (favours the offer). No cost of capital: count it only if the
// company actually needs the cash earlier.
const annualRenewal = (age) => ANNUAL_NONRENEWAL == null ? ANNUAL_RENEWAL_DEFAULT
  : 1 - (Array.isArray(ANNUAL_NONRENEWAL) ? ANNUAL_NONRENEWAL[Math.min(age, ANNUAL_NONRENEWAL.length - 1)] : ANNUAL_NONRENEWAL);
function net24(age, d1, q2, tau) {
  const m = ageModel(age), r = rLow(age) ** (1 - tau), phi = phiOf(m.p, r);
  const eCf = (1 - phi) * fwd(age + 4).v / 12, eAnn = (1 - tau) * eCf + tau * annualRenewal(age);
  return { r, y1: netPerTaker(12 * (1 - d1), m, r), y2: 12 * q2 * eAnn - 12 * eCf };
}
function blanket24(t, d1, q2, tau) { // takers hold t of segment MRR
  const rows = segRows.map(x => ({ ...x, m: ageModel(x.age), o: net24(x.age, d1, q2, tau) }));
  const share = rows.reduce((s, x) => s + x.mrr * ((1 - x.m.p) + x.m.p * x.o.r), 0);
  const scale = t * fullSegmentMRR / share;
  return rows.reduce((s, x) => s + x.mrr * scale * ((1 - x.m.p) + x.m.p * x.o.r) * (x.o.y1 + x.o.y2), 0);
}
const tauNeeded = (val) => {
  if (val(0) >= 0) return 'pays at tau 0';
  if (val(1) < 0) return 'loses even at tau 1';
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; val(m) < 0 ? lo = m : hi = m; }
  return `tau >= ${lo.toFixed(2)}`;
};
const OFFERS24 = [[`-${OFFER_DISCOUNT * 100}% persists`, OFFER_DISCOUNT, 1 - OFFER_DISCOUNT],
  ...(EXISTING_DISCOUNT != null && EXISTING_DISCOUNT !== OFFER_DISCOUNT
    ? [[`-${OFFER_DISCOUNT * 100}% yr 1, then -${EXISTING_DISCOUNT * 100}%`, OFFER_DISCOUNT, 1 - EXISTING_DISCOUNT], [`-${EXISTING_DISCOUNT * 100}% (existing)`, EXISTING_DISCOUNT, 1 - EXISTING_DISCOUNT]]
    : [])];
console.log(`\n=== 8. Beyond year one: 24-month net per taker by tau${ANNUAL_NONRENEWAL == null ? ` — annual renewal = DEFAULT ${ANNUAL_RENEWAL_DEFAULT} (FLAG IN OUTPUT)` : ''} ===`);
for (const tau of [0, 0.5, 1]) {
  for (let a = 0; a <= 6; a++) {
    console.log(`tau ${tau} | age ${a} | ` + OFFERS24.map(([n, d1, q2]) => { const o = net24(a, d1, q2, tau); return `${n}: ${fmt(o.y1 + o.y2)} (y1 ${fmt(o.y1)}, y2 ${fmt(o.y2)})`; }).join(' | '));
  }
  for (const [n, d1, q2] of OFFERS24.slice(0, 2)) console.log(`tau ${tau} | full segment, ${n}, takers 10% of MRR: ${Math.round(blanket24(0.1, d1, q2, tau) / 1000)}k over 24 months`);
}
console.log('tau needed for the 24-month net to reach 0:');
for (let a = 0; a <= 8; a++) {
  console.log(`age ${a}: ` + OFFERS24.map(([n, d1, q2]) => `${n}: ${tauNeeded(t => { const o = net24(a, d1, q2, t); return o.y1 + o.y2; })}`).join(' | '));
}
for (const [n, d1, q2] of OFFERS24.slice(0, 2)) console.log(`full segment, ${n}: ${tauNeeded(t => blanket24(0.1, d1, q2, t))}`);
console.log('Evidence on tau: if annual payers renew no better than long-tenure monthly payers stay, lock-in at long tenure is small.');

// ── 9. Tail-factor sensitivity ──────────────────────────────────────────────
console.log('\n=== 9. Tail sensitivity (pure-tail V12 under 0.92/0.95/0.97) ===');
for (const tf of [0.92, 0.95, 0.97]) {
  let v = 0, s = 1;
  const g = tf ** (1 / 3);
  for (let j = 0; j < 12; j++) { v += s; s *= g; }
  console.log(`tail ${tf}: pure-tail V12 = ${v.toFixed(2)} mo`);
}

// ── 10. Monthly/annual mix sensitivity ──────────────────────────────────────
// Retention tables usually blend monthly and annual payers: step churn c = wA*cA + (1-wA)*cM.
// Sections 4–7 use the central scenario (ANNUAL_STEP_CHURN); this shows how much the annual-churn assumption matters.
if (W_ANNUAL > 0) {
  const mixScenarios = [
    { name: 'annual churns half the blend  ', cA: c => 0.5 * c },
    { name: 'annual ~80%/yr renewal (5.4%/q)', cA: () => 0.054 },
    { name: 'extreme: annual never churns   ', cA: () => 0 },
  ];
  const fMix = (cAOf) => (k) => { const c = 1 - stepF(k), cA = Math.min(cAOf(c), c); return 1 - Math.min(Math.max((c - W_ANNUAL * cA) / (1 - W_ANNUAL), 0), 0.9); };
  console.log(`\n=== 10. Monthly/annual mix sensitivity (annual share ${(W_ANNUAL * 100).toFixed(0)}% of table MRR) ===`);
  for (const sc of mixScenarios) {
    const f = fMix(sc.cA);
    const V12m = perCohort.reduce((s, pc) => s + fwd(pc.age, 12, 0, 0, f).v * pc.mrr, 0) / totalMRR;
    const S12m = perCohort.reduce((s, pc) => s + fwd(pc.age, 12, 0, 0, f).s * pc.mrr, 0) / totalMRR;
    console.log(`${sc.name}: monthly-only V12 ${V12m.toFixed(2)} mo | equiv churn ${((1 - S12m ** 0.25) * 100).toFixed(1)}%/q | delta vs lock ${(LOCK - V12m).toFixed(2)} mo/taker`);
  }
  // Flip threshold: annual share at which monthly-only churn reaches the lock's break-even churn (blended curve)
  const cBE = 1 - solveBreakEvenMonthly(LOCK) ** 3;
  const S12b = perCohort.reduce((s, pc) => s + fwd(pc.age, 12, 0, 0, stepF).s * pc.mrr, 0) / totalMRR;
  const cBlend = 1 - S12b ** 0.25;
  for (const cA of [0, 0.05]) {
    const wFlip = (cBlend - cBE) / (cA - cBE);
    const txt = wFlip > 0 && wFlip < 1 ? `${(wFlip * 100).toFixed(0)}%` : 'impossible (blend already above break-even)';
    console.log(`flip: annual share needed for monthly-only churn >= break-even ${(cBE * 100).toFixed(1)}%/q (annual churn ${(cA * 100).toFixed(0)}%/q): ${txt}`);
  }
}

// ── 11. Temporary churn shock (product incident, competitor move), selection-adjusted ──
// A shock raises p, so the would-be-churner share among takers rises too — never model it with a fixed churner-share column.
// Central: baseline would-be churners take up at r_mid, shock-added ones at r_low (customers unhappy with the product rarely prepay a year of it).
if (SHOCKS.length) {
  const rShockCentral = (a, x, k) => { const pb = ageModel(a).p, ps = ageModel(a, x, k).p; return ps > 0 ? (pb * rMid(a) + (ps - pb) * rLow(a)) / ps : rMid(a); };
  const R_SHOCK = { 'own-data bound': (a) => rLow(a), 'central': rShockCentral, 'none (r=1)': () => 1 };
  console.log(`\n=== 11. Churn shock, -${OFFER_DISCOUNT * 100}% to the full segment, takers hold 10% of MRR: currency k/yr (would-be churners among takers) ===`);
  for (const [x, k] of [[0, 0], ...SHOCKS]) {
    const pAll = segRows.reduce((s, r) => s + ageModel(r.age, x, k).p * r.mrr, 0) / fullSegmentMRR;
    const cells = Object.entries(R_SHOCK).map(([n, rf]) => { const b = blanket(0.1, rf, OFFER_DISCOUNT, x, k); return `${n} ${Math.round(b.total / 1000)}k (${(b.phi * 100).toFixed(0)}%)`; });
    console.log(`${x ? `+${(x * 100).toFixed(0)}pp x ${k} mo` : 'no shock'} (12-mo churn ${(pAll * 100).toFixed(0)}%): ${cells.join(' | ')}`);
  }
  for (const [n, rf] of [['central', rShockCentral], ['none (r=1)', () => 1]]) {
    let lo = 0, hi = 0.3;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; blanket(0.1, rf, OFFER_DISCOUNT, m, 12).total < 0 ? lo = m : hi = m; }
    console.log(`sustained extra churn (12 mo) for break-even, ${n}: ${lo >= 0.29 ? '> +29' : '+' + (lo * 100).toFixed(1)} pp/month`);
  }
}
