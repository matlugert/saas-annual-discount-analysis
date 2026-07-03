# saas-annual-discount-analysis

"Should we offer our existing users 30% off if they switch to annual?" — usually, no. This skill shows you why, with your own data.

A Claude Code skill that evaluates whether a discounted (annual) plan offer to an existing customer segment is net-revenue-positive — weighing the guaranteed revenue give-up against the churn risk it insures. Paste your cohort retention table; it computes the numbers that actually decide the question, including the cohort-age sweet spot where the discount *does* pay.

## Why this exists

Cohort retention tables mislead intuition twice:

1. **Offers are only seen by survivors.** A cohort may lose 45% of its MRR in the first quarter, but those users are gone — the users who'd see your offer churn at a fraction of the cohort average, and their churn keeps falling with tenure.
2. **The wrong people take prepay discounts.** Users halfway out the door don't prepay a year. Discount-takers skew loyal, so most of the discount is a pure margin transfer to customers who would have stayed anyway.

Put together: a 30% annual discount needs an audience churning ~19% per quarter to break even, while a typical mature SMB-SaaS base churns 5–15%. The blanket answer is usually negative — and the same offer is strongly positive in the cancel flow or in the first quarter after signup.

## How it works

```
You share a cohort retention table + discount %
         ↓
Skill asks for required inputs (target segment, MRR vs logo retention)
and offers optional refinements — monthly/annual mix, segment share,
existing annual plan, planned price changes. Defaults are used and
flagged when you don't have them; it never blocks on optional data.
         ↓
Deterministic calculation script (no LLM arithmetic):
survivor forward churn · break-even per discount depth ·
per-cohort 12-month forfeit · adverse-selection threshold ·
aggregate impact grid · sweet spot by cohort age · 24-month view
         ↓
Recommendation memo — verdict first, then the three decisive numbers
(+ optional single-page HTML decision brief for sharing)
```

## What it computes

| Output | The question it answers |
|---|---|
| Survivor forward churn by cohort age | What do the users who'd actually see the offer really churn at? |
| Break-even churn per discount depth | How fast must the audience churn for −10/−15/−20/−25/−30% to pay? |
| Forward 12-month value per cohort | What does a survivor pay anyway vs. the discounted annual lock? |
| Adverse-selection threshold | What share of takers must be true would-be churners to break even? |
| Aggregate grid (take-rate × churner share) | What does the blanket offer cost per year, in currency? |
| Sweet spot by cohort age | Up to what customer age does each discount depth stay net-positive? |

Reference points (pure math, 12-month horizon): a −10% annual breaks even at 5.7% quarterly churn, −15% at 8.8%, −20% at 12.0%, −25% at 15.4%, −30% at 19.0%.

## Install

```bash
git clone https://github.com/matlugert/saas-annual-discount-analysis
cp -r saas-annual-discount-analysis/skills/annual-discount-analysis ~/.claude/skills/
```

Or per project: copy the folder into `<project>/.claude/skills/`.

Then in any Claude Code session:

```
/annual-discount-analysis 30% annual for legacy monthly users
```

Or just paste a retention table and ask "should we show these users a discounted annual offer?" — the skill triggers on intent.

## What makes this different

- **Survivors, not cohort averages.** The single biggest error in these decisions — judging the offer by cohort-level churn overstates the risk 3–5×.
- **Corrected adverse-selection accounting.** Loyal takers' counterfactual is 12 full months, not the blended average; the naive version understates the loss 2–3×.
- **12-month eligibility test, not next-quarter churn.** An annual lock covers a year; a cohort can churn 23% next quarter and still lose you money at −30%.
- **Deterministic script, no LLM math.** Every load-bearing number comes from a small Node script you can read, rerun, and audit — including a transcription check against your table's own weighted-average row.
- **Asks for what it needs, defaults the rest.** Required inputs are requested up front; optional refinements (annual/monthly mix, segment share, planned price increases) are requested once and defaulted with an explicit flag if unavailable.
- **It doesn't just say no.** The output includes where the same discount is net-positive: cancel-flow save offers, dunning, at-risk triggers, and the signup-age window.

## Author

[Matthias Lugert](https://github.com/matlugert)

## License

MIT
