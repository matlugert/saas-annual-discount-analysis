---
name: annual-discount-analysis
description: Evaluate whether a discounted (annual) plan offer to an existing customer segment is net-revenue-positive, weighing discount depth against real churn risk. Use when the user asks "should we offer X% off annual", "discount vs churn risk", "lohnt sich der Rabatt / das Offer", shares a cohort retention table for a pricing decision, or wants the segmentation sweet spot (which cohort age qualifies for which discount depth). Computes survivor forward churn, break-even churn per discount depth, per-cohort forfeit, adverse-selection threshold, aggregate revenue-impact grid, and cohort-age cut-offs. NOT for new-customer list pricing or promo design without retention data.
argument-hint: "[discount % + target segment, e.g. '30% annual for legacy monthly users']"
---

# Annual Discount Analysis

Decide whether actively showing a discounted plan offer (typically annual prepay) to an existing segment is net-revenue-positive — or whether the segment's churn is already too low for the discount to pay. Works for any subscription business with cohort retention data. Typical pattern: survivors of mature cohorts churn 5–15%/quarter while a 30% discount needs ~19% to break even, so blanket offers to an existing base are usually net-negative and the sweet spot sits in the first 1–2 quarters of customer age.

## Step 1 — Intake

Ask for missing **required** inputs before computing. List the **optional** inputs once (with why they matter), then proceed with stated defaults if the user doesn't have them — never block on optional data, but flag every default used in the final output.

### Required (ask if not provided)

| Input | Form | Why |
|---|---|---|
| Cohort retention table | Retention % by quarter (or month) since acquisition, per cohort, with cohort values (new MRR per cohort) — screenshot or pasted table | The entire analysis derives from cohort-to-cohort transitions |
| Discount depth(s) | e.g. 30%, or several to compare | Sets the lock value: annual at discount d guarantees 12×(1−d) months |
| Target segment | Who would actively see the offer (which cohorts / which users within them) | Survivors of old cohorts ≠ cohort average; segment size drives the aggregate |
| Retention metric | MRR retention or logo retention? | MRR retention includes up-/downgrades — affects interpretation |

### Optional / advanced (request, then default + flag)

| Input | Why it matters | Default if unknown |
|---|---|---|
| Monthly vs annual mix of the target base | Retention tables blend both; the offer only concerns monthly payers, and annual users' churn shows only at renewal boundaries | Assume predominantly monthly; flag |
| Share of cohort MRR actually in the segment | e.g. only part of the old cohorts may still be on a legacy product or otherwise eligible — scales the aggregate, not the per-user verdict | 100% of cohort MRR; flag loudly |
| Existing annual plan + its discount | The incremental question is vs. the offer already on the shelf | Ask; else assume none exists |
| Planned price changes | An annual lock exempts takers from an upcoming increase — this interaction can dominate the whole calculation | Ask explicitly; assume none |
| Migration / sunset plans for the segment's product | A forced sunset flips the frame to a deliberately priced lock-in — a different calculation | Ask; assume none |
| Involuntary churn share, annual renewal rate | Second-order effects (dunning alternative; year-2 view) | Benchmarks: 20–40% involuntary; 60–80% annual renewal |
| Total MRR of the base | To size older cohorts missing from the table as a residual | Ask; else analyze visible cohorts only and say so |

## Step 2 — Compute (deterministic script, never hand math)

Copy [references/retention-calc-template.mjs](references/retention-calc-template.mjs) to the scratchpad, replace the cohort data + parameters, run with `node`. It produces every load-bearing number:

1. **Transcription validation** — reproduce the table's weighted-average row (≤1pp per column) before trusting anything.
2. **Survivor forward churn** — MRR-weighted quarter-over-quarter transition factors per age step (NOT cohort-average retention; that overstates churn 3–5×). Tail beyond observed steps: 95%/q, sensitivity 92–97%.
3. **Break-even churn per discount depth** — solve Σ_{j=0..11} m^j = 12×(1−d). Reference points: 10%→5.7%/q · 15%→8.8% · 20%→12.0% · 25%→15.4% · 30%→19.0%.
4. **Per-cohort forward 12-month value (V12)** — geometric monthly interpolation of quarterly factors; compare vs the lock 12×(1−d).
5. **Adverse selection — use the CORRECT accounting** (the naive version understates the loss 2–3×): loyal takers are by definition 12-month survivors → counterfactual **12.0 months**, not blended V12. Would-be churner counterfactual V_churn from V12 = S12×12 + (1−S12)×V_churn. Break-even churner share of takers: φ* = (12−L)/((12−L)+(L−V_churn)) with L = lock months.
6. **Aggregate grid** — take-rate × true-churner-share, in currency/yr on the actual segment MRR.
7. **Sweet spot by cohort age** — V12(age) for ages 0..N vs each lock → age cut-offs. Next-quarter churn is NOT the eligibility test: the lock covers 12 months and churn decays fast (an age-1 cohort can churn 23% next quarter yet already lose money at −30%).
8. **24-month view** — annual renewal ρ scenarios (60/70/80%), discount persisting vs first-year-only.
9. **Monthly/annual mix sensitivity** — if the table blends annual payers (share wA), the monthly-only audience churns harder than the blend: per step, cM = (c − wA·cA)/(1−wA). Run stickiness scenarios for cA (half the blend / ~80% renewal / never churns) plus the flip threshold for wA. Typical result: the aggregate shrinks by (1−wA), per-taker loss narrows but survives, and the sweet-spot age windows widen ~1 quarter; a blanket verdict rarely flips below ~50% annual share.

## Step 3 — Adversarial check before delivering

- Re-derive the headline numbers independently (second agent or manual spot-check of 2–3 cells).
- Hunt the known failure modes: wrong loyal-taker counterfactual (see 5), aggregate computed on visible cohorts only while the decision targets the full base, next-quarter-churn used as 12-month eligibility, segment-share overcounting (mixed product versions / annual users in the table).
- Check for interacting plans (price increases, migrations, existing promos) and confirm who owns pricing before recommendations go out.

## Step 4 — Deliver

- **Chat memo (in the user's language)**: recommendation first, then the three decisive numbers (break-even churn vs actual, loss per taker, aggregate revenue/yr), the calculation logic, where the same lever IS net-positive (cancel-flow save offer, dunning, at-risk triggers, shallower discount), open data points.
- **On request — HTML decision brief** (Artifact): argument-chain structure that works — 01 the question (base composition) · 02 the trap (retention curve, survivors vs cohort average) · 03 break-even by depth vs actual churn band · 04 per-cohort forfeit bars · 05 selection squares (required vs realistic churner share) · 06 the bill (cards + scenario grid + interactions callout) · 07 where the lever pays · appendix: sweet spot by cohort age.
- Offer to save the brief wherever the team keeps shared deliverables.

## Reference numbers (benchmarks, verified July 2026)

- Typical annual discount: 15–20%; most common anchor 16.7% ("2 months free"); 30% is top-decile and renewal WTP degrades past 30% (ProfitWell/InnerTrends).
- Discounted customers churn ~2× afterwards; retention offers land on the unmovable and can even increase churn ("sleeping dogs" — Ascarza JMR 2016/2018; Lemmens & Gupta 2020).
- Cancel-flow save offers: ~62% acceptance (Churnkey). Involuntary churn: 20–40% of SaaS churn (~26% Recurly); dunning recovers 50%+ at zero discount; failed ANNUAL renewals recover far worse than monthly (23% vs 53%).
- If the company has run discount promos before, pull those cohorts' churn — discount-acquired/retained users typically churn dramatically harder, which calibrates the realistic churner share of takers.

## Pitfalls (each one flipped or nearly flipped a real conclusion)

1. **Survivors, not cohort averages.** The offer is only ever seen by users who are still there.
2. **Loyal-taker counterfactual = 12 months.** Using blended V12 understates the blanket loss 2–3×.
3. **12-month lock ⇒ 12-month eligibility test**, not next-quarter churn.
4. **The table mixes populations** — annual payers, users migrated to a newer product version. Scale the aggregate to the true segment; per-user economics usually survive, the headline number doesn't.
5. **Unshown older cohorts** are often the majority of the target MRR and the stickiest — never quote an aggregate on visible cohorts only without saying so.
6. **Price-increase interaction**: an annual lock at discount just before an increase is a double give-away and attracts exactly the price-sensitive.
7. Integer-rounded retention on small tail bases → treat single-cohort tail factors as noisy; pool across cohorts.
