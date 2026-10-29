---
name: annual-discount-analysis
description: Evaluate whether a discounted (annual) plan offer to an existing customer segment is net-revenue-positive, weighing discount depth against real churn risk. Use when the user asks "should we offer X% off annual", "discount vs churn risk", "lohnt sich der Rabatt / das Offer", shares a cohort retention table for a pricing decision, or wants the segmentation sweet spot (which cohort age qualifies for which discount depth). Computes survivor forward churn, break-even churn per discount depth, per-cohort forfeit, a calibrated adverse-selection model (who actually takes the offer), model-based revenue grids incl. temporary churn shocks, a 24-month view with a causal lock-in share, and selection-adjusted tenure cut-offs. NOT for new-customer list pricing or promo design without retention data.
argument-hint: "[discount % + target segment, e.g. '30% annual for legacy monthly users']"
---

# Annual Discount Analysis

Decide whether actively showing a discounted plan offer (typically annual prepay) to an existing segment is net-revenue-positive — or whether the segment's churn is already too low for the discount to pay. Works for any subscription business with cohort retention data. Typical pattern: survivors of mature cohorts churn 5–15%/quarter while a 30% discount needs ~19% to break even, so blanket offers to an existing base are usually net-negative. Once the model accounts for who actually takes a prepay offer (mostly customers who would have stayed), the sweet spot shrinks to the first ~1–2 quarters for a shelf-level discount and often to nowhere for a deep one.

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
| Monthly vs annual mix of the target base | Retention tables blend both; the offer only concerns monthly payers, and annual users' churn shows only at renewal boundaries | 1/3 annual for blended tables; flag |
| Annual payers' 12-month non-renewal by tenure | Calibrates the lower bound of r, how strongly the offer attracts loyal customers (Step 2, item 5), and the renewal rate in the 24-month view (item 8) | r_low = 0.3, renewal 80%; flag loudly |
| Customer-level data (DWH / billing DB) | Realised 12-month value and survival per tenure, split by billing frequency, beat interpolation from a blended cohort table | Use the cohort table |
| Share of cohort MRR actually in the segment | e.g. only part of the old cohorts may still be on a legacy product or otherwise eligible — scales the aggregate, not the per-user verdict | 100% of cohort MRR; flag loudly |
| Existing annual plan + its discount | The incremental question is vs. the offer already on the shelf (cannibalisation, per-taker comparison) | Ask; else assume none exists |
| Planned price changes | An annual lock exempts takers from an upcoming increase — this interaction can dominate the whole calculation | Ask explicitly; assume none |
| Temporary churn shock (product incident, competitor move) | Raises the share of would-be churners and shifts who takes the offer (item 10) | None; an observed uplift mixed with another effect (e.g. a price increase) is a ceiling, never the estimate |
| Migration / sunset plans for the segment's product | A forced sunset flips the frame to a deliberately priced lock-in — a different calculation | Ask; assume none |
| Involuntary churn share | Second-order effect (dunning as the zero-discount alternative) | Benchmark: 20–40% of churn |
| Cash position | Earlier payment only has value if the company needs the cash; with excess cash, cost of capital is no argument for prepay | Don't count it; ask if cash is tight |
| Total MRR of the base | To size older cohorts missing from the table as a residual | Ask; else analyze visible cohorts only and say so |

## Step 2 — Compute (deterministic script, never hand math)

Copy [references/retention-calc-template.mjs](references/retention-calc-template.mjs) to the scratchpad, replace the cohort data + parameters, run with `node`. It produces every load-bearing number. With customer-level data, compute per tenure directly instead of interpolating:
- monthly payers' MRR-weighted quarterly transitions;
- realised 12-month value (V12) and survival (S12) from several snapshots, with the horizon ending before any price change so an uplift doesn't count as retention;
- annual payers' non-renewal.

Feed these into the same selection formulas. Interpolation from quarterly factors runs ~0.2 months low.

1. **Transcription validation** — reproduce the table's weighted-average row (≤1pp per column) before trusting anything.
2. **Survivor forward churn** — MRR-weighted quarter-over-quarter transition factors per age step (NOT cohort-average retention; that overstates churn 3–5×). Tail beyond observed steps: 95%/q, sensitivity 92–97%. If the table blends annual payers, de-blend to the monthly audience: cM = (c − wA·cA)/(1−wA).
3. **Break-even churn per discount depth** — solve Σ_{j=0..11} m^j = 12×(1−d). Reference points: 10%→5.7%/q · 15%→8.8% · 20%→12.0% · 25%→15.4% · 30%→19.0%.
4. **Forward 12-month value (V12) by age, before selection** — on the monthly-payer curve; compare vs the lock L = 12×(1−d). This is the r = 1 case of item 5: never derive cut-offs from it.
5. **Selection model — the core.** Per age:
   - **Who is at risk:** p = 1 − S12 is the share of MRR that would leave within 12 months.
   - **What a would-be churner pays without the offer:** V_churn = (V12 − 12·S12)/(1 − S12).
   - **What a loyal taker costs:** the counterfactual is **12.0 months**, not blended V12, which would understate the loss 2–3×.
   - **The selection parameter:** would-be churners take the offer at **r** × the rate of stayers, so the churner share among takers is φ = p·r/(p·r + 1 − p).
   - **Net per taker:** φ·(L − V_churn) − (1−φ)·(12 − L).
   - **The decisive number, r needed:** = odds(φ\*)/odds(p), where φ\* = (12−L)/((12−L)+(L−V_churn)). Above 1, the offer loses even with randomly drawn takers.
   - **Bounds for r:**
     - **Lower:** r_low = odds(annual non-renewal)/odds(p) at the same tenure. It is a lower bound because annual payers' lower churn also contains the lock and auto-renewal effect.
     - **Upper:** 1, no selection.
     - **Central:** √r_low, the geometric midpoint.
   - **Verdict per cell:**
     - **pays under any plausible selection:** r needed ≤ r_low;
     - **pays in the central case:** r needed ≤ √r_low;
     - **only with weak selection:** r needed ≤ 1;
     - **loses even without selection:** r needed > 1.
6. **Aggregate grid, model-based** — takers' share of segment MRR (5/10/20%) × selection (own-data bound / central / none), in currency/yr on the full segment. Also report the needed churner share among takers against the share under each r. Typical finding: even randomly drawn takers fall short, because old tenure holds most MRR and rarely leaves.
7. **Segmentation by tenure** — per depth, the ages where it pays under any plausible selection and in the central case. Compare the proposed depth against the existing shelf discount per taker. A deeper discount usually earns less per taker even where both pay, and needs a large take-up multiple to win. Next-quarter churn is NOT the eligibility test: the lock covers 12 months and churn decays fast.
8. **Beyond year one: 24-month view with a causal lock-in share τ.** Annual payers retain better than monthly payers. Part of that is selection, part may be caused by the contract itself (one cancel decision a year, renewal by default). τ is the causal share.
   - **What τ sets:**
     - **Year 1:** r = r_low^(1−τ). τ = 0 is pure selection, τ = 1 means random takers, and τ = 0.5 reproduces the central case of item 5.
     - **Year 2:** in full-year equivalents. Counterfactual E_cf = (1−φ)·V12(age+4)/12; would-be churners pay nothing, and ignoring their reactivations favours the offer. Annual takers E_ann = (1−τ)·E_cf + τ·annual renewal, paying 12·q2 per year (q2 = price factor at renewal).
   - **Report:**
     - net per taker for τ = 0 / 0.5 / 1;
     - for three offers: discount persists, proposed depth for the first year then the shelf discount, and the shelf discount;
     - the 24-month blanket effect;
     - the τ needed per tenure.
   - **Evidence on τ:** where annual payers renew no better than monthly payers of the same tenure stay, lock-in is small. That's typical at long tenure, which holds most MRR.
   - **Other effects, as a callout:**
     - **For annual:** payment fees (~11 fewer transactions) and contracted-revenue optics.
     - **Against the offer:** sleeping dogs, cannibalisation, refunds, anchoring at renewal, the price lock, and consumer-law limits on tacit renewal (Germany, B2C).
     - **Cost of capital:** only if cash is tight.
9. **Monthly/annual mix sensitivity** — how much the annual-churn assumption behind the de-blending matters (half the blend / ~80% renewal / never churns), plus the flip threshold for wA.
10. **Temporary churn shock (optional)** — extra churn x per month for k months.
    - **Central case:** baseline would-be churners take the offer at the central r; shock-added ones only at r_low, since customers unhappy with the product rarely prepay a year of it.
    - **Report:** the grid, and the sustained shock needed for break-even (central and r = 1).
    - **Mixed observed uplift:** if it mixes the shock with another effect (e.g. a price-increase wave), use it only as a ceiling and say so.

## Step 3 — Adversarial check before delivering

- Re-derive the headline numbers independently (second agent or manual spot-check of 2–3 cells). For model changes, run a parity check: patch the template with the case's curve and compare to an independent implementation.
- Hunt the known failure modes:
  - wrong loyal-taker counterfactual (item 5);
  - aggregate computed on visible cohorts only while the decision targets the full base;
  - next-quarter churn used as 12-month eligibility;
  - segment-share overcounting (mixed product versions, annual users in the table);
  - fixed churner-share grids, which ignore that p and the takers' mix move with tenure and with shocks;
  - cut-offs from averages shipped with an "upper bound, confirm with a holdout" disclaimer instead of r needed;
  - a 12-month view presented as complete, with no τ bound on year-2 lock-in;
  - cost of capital counted while the company sits on excess cash.
- Check for interacting plans (price increases, migrations, existing promos) and confirm who owns pricing before recommendations go out.

## Step 4 — Deliver

- **Chat memo (in the user's language).** Recommendation first, then the decisive numbers:
  - break-even churn vs actual churn;
  - r needed vs the plausible r range;
  - aggregate revenue/yr, central case plus range.

  Then the calculation logic, where the same lever IS net-positive (a capped cancel-flow save offer — see pitfall 14, dunning, at-risk triggers, the shelf discount for new customers), and open data points.
- **On request — HTML decision brief** (Artifact). An argument chain that works:
  - 01 the question (base composition);
  - 02 the trap (retention curve, survivors vs cohort average);
  - 03 break-even by depth vs actual churn band;
  - 04 forfeit bars per tenure, labelled as averages (the r = 1 case);
  - 05 selection: the model in plain words, plus squares for would-be churners per 10 takers (needed / random draw / central / own-data bound);
  - 06 the bill: cards, a take-up × selection grid and an interactions callout;
  - 07 optional churn shock with selection;
  - 08 beyond year one: the 24-month blanket grid by τ, τ needed by tenure, and an other-effects callout;
  - 09 where the lever pays;
  - appendix: per-tenure table (MRR, would leave, r range, r needed and central months per taker per depth) and a segmentation rule stated from it, with no disclaimers. The holdout belongs in the rule, because comparing takers' renewal and 24-month revenue with the holdout measures r and τ (first read at month 13, final at month 24).
- Offer to save the brief wherever the team keeps shared deliverables.

## Reference numbers (benchmarks, verified July 2026)

- Typical annual discount: 15–20%; most common anchor 16.7% ("2 months free"); 30% is top-decile and renewal WTP degrades past 30% (ProfitWell/InnerTrends).
- Discounted customers churn ~2× afterwards; retention offers land on the unmovable and can even increase churn ("sleeping dogs" — Ascarza JMR 2016/2018; Lemmens & Gupta 2020).
- Cancel-flow save offers: ~62% acceptance (Churnkey). Involuntary churn: 20–40% of SaaS churn (~26% Recurly); dunning recovers 50%+ at zero discount; failed ANNUAL renewals recover far worse than monthly (23% vs 53%).
- If the company has run discount promos before, pull those cohorts' churn — discount-acquired/retained users typically churn dramatically harder, which calibrates the realistic churner share of takers.
- Selection calibration from one SMB SaaS:
  - revealed r ≈ 0.1 in the signup quarter, 0.25–0.37 at 1–4 quarters, 0.5–0.7 beyond, about 0.5 MRR-weighted;
  - at long tenure, annual payers renewed no better than monthly payers stayed: little lock-in there;
  - a blanket −30% broke even over 24 months only at τ = 1, while −20% for new customers paid from τ ≈ 0.3.

## Pitfalls (each one flipped or nearly flipped a real conclusion)

1. **Survivors, not cohort averages.** The offer is only ever seen by users who are still there.
2. **Loyal-taker counterfactual = 12 months.** Using blended V12 understates the blanket loss 2–3×.
3. **12-month lock ⇒ 12-month eligibility test**, not next-quarter churn.
4. **The table mixes populations** — annual payers, users migrated to a newer product version. Scale the aggregate to the true segment; per-user economics usually survive, the headline number doesn't.
5. **Unshown older cohorts** are often the majority of the target MRR and the stickiest — never quote an aggregate on visible cohorts only without saying so.
6. **Price-increase interaction**: an annual lock at discount just before an increase is a double give-away and attracts exactly the price-sensitive.
7. Integer-rounded retention on small tail bases → treat single-cohort tail factors as noisy; pool across cohorts.
8. **Averages are the r = 1 case.** A V12 below the lock says nothing about who takes the offer. Cut-offs from averages with an "upper bound" disclaimer are dangerous because readers act on the cut-off. In a real brief, averages said "−30% pays for two quarters"; with selection, −30% paid nowhere and −20% only in the first six months.
9. **Fixed churner-share columns hide shocks.** A shock raises p and with it the churner share among takers. A fixed-share grid read "the bill barely moves" where the model showed the loss roughly halving.
10. **Revealed r is a lower bound**, least reliable in the signup quarter: annual signups are a different population, and the lock holds would-be early churners. Use it as a bound, never as the estimate.
11. **A mixed observed uplift is a ceiling, not an estimate** — e.g. churn after a price increase that coincides with a product incident.
12. **A 12-month model leaves out year-2 lock-in.** Bound it with τ instead of ignoring it or assuming it. In a real case, this flipped nothing for the blanket offer, but it widened the window for new customers.
13. **Cost of capital only if cash is tight.** With excess cash, earlier payment is no argument for prepay. Leave it out rather than add a small plus that reads like support.
14. **Cancel-flow saves: the arithmetic is the easy part.** A 30% save for three months still pays if most acceptors (~80–90%) would have stayed anyway. The risks lie elsewhere:
    - **Undoing a price increase:** after one, a deep save can undercut the old price. 30% off a price raised by 20% lands ~16% below the old one.
    - **Customers learn:** once cancelling earns a discount, customers who would never have left start cancelling. That changes who enters the flow, which the arithmetic assumes stays fixed.
    - **The cause stays:** a discount doesn't fix a product problem.
    - **What to recommend:** route by cancel reason, keep the save near the pre-increase price (often the existing annual plan does that), and use a deep discount only as a last step: time-limited, once per customer, A/B-tested with a holdout. Watch the rate at which long-tenure customers enter the cancel flow.
