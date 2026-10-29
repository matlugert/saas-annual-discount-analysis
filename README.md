# saas-annual-discount-analysis

"Should we offer our existing users 30% off if they switch to annual?" — usually, no. This skill shows you why, with your own data.

A Claude Code skill that evaluates whether a discounted (annual) plan offer to an existing customer segment is net-revenue-positive — weighing the guaranteed revenue give-up against the churn risk it insures. Paste your cohort retention table; it computes the numbers that actually decide the question, including the customer-age window where the discount *does* pay once you count who actually takes it.

## Why this exists

Cohort retention tables mislead intuition twice:

1. **Offers are only seen by survivors.** A cohort may lose 45% of its MRR in the first quarter, but those users are gone — the users who'd see your offer churn at a fraction of the cohort average, and their churn keeps falling with tenure.
2. **The wrong people take prepay discounts.** Users halfway out the door don't prepay a year. Discount-takers skew loyal, so most of the discount is a pure margin transfer to customers who would have stayed anyway. The skill models this explicitly and calibrates it on your own annual-vs-monthly churn.

Put together: a 30% annual discount needs an audience churning ~19% per quarter to break even, while a typical mature SMB-SaaS base churns 5–15%. The blanket answer is usually negative. Discounts work where customers really are leaving, or in the first months after signup — and even there, depth matters.

## How it works

```
You share a cohort retention table + discount %
         ↓
Skill asks for required inputs (target segment, MRR vs logo retention)
and offers optional refinements — monthly/annual mix, annual renewal,
segment share, existing annual plan, planned price changes, a temporary
churn shock. Defaults are used and flagged when you don't have them;
it never blocks on optional data.
         ↓
Deterministic calculation script (no LLM arithmetic):
survivor forward churn · break-even per discount depth ·
12-month value by age · selection model (who takes the offer) ·
take-up × selection grid · tenure rule · churn-shock scenarios ·
24-month view with a causal lock-in share
         ↓
Recommendation memo — verdict first, then the decisive numbers
(+ optional single-page HTML decision brief for sharing)
```

## What it computes

| Output | The question it answers |
|---|---|
| Survivor forward churn by customer age | What do the users who'd actually see the offer really churn at? |
| Break-even churn per discount depth | How fast must the audience churn for −10/−15/−20/−25/−30% to pay? |
| 12-month value by age, before selection | What does a survivor pay anyway vs. the discounted annual lock? |
| Selection model: *r needed* per age | How readily must would-be churners take the offer, relative to customers who stay, for it to pay — and where does your own data put that? |
| Aggregate grid (take-up × selection) | What does the blanket offer cost per year, from strong selection to none? |
| Segmentation by tenure | Up to what customer age does each depth pay once selection is counted — and how does the proposed depth compare with the annual plan you already sell? |
| Churn-shock scenarios | Does a temporary churn spike (product incident, competitor move) change the answer? |
| 24-month view with lock-in share τ | If the annual contract itself keeps customers longer, how much of that effect would the offer need in order to pay? |

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
- **Selection is modelled, not waved away.** Would-be churners take the offer at *r* times the rate of customers who stay. *r* is bounded by your own data (annual non-renewal vs monthly churn at the same tenure) and by 1 (no selection). The skill reports the *r* each customer age would need, so recommendations come without "treat as upper bound" disclaimers.
- **Corrected loyal-taker accounting.** A loyal taker's counterfactual is 12 full months, not the blended average; the naive version understates the loss 2–3×.
- **12-month eligibility test, not next-quarter churn.** An annual lock covers a year; a cohort can churn 23% next quarter and still lose you money at −30%.
- **Year two is bounded, not ignored.** How much of annual payers' better retention the contract itself causes is unknown. The skill shows the answer from 0% to 100% causal, and the share each offer would need.
- **Deterministic script, no LLM math.** Every load-bearing number comes from a small Node script you can read, rerun, and audit — including a transcription check against your table's own weighted-average row.
- **Asks for what it needs, defaults the rest.** Required inputs are requested up front; optional refinements are requested once and defaulted with an explicit flag if unavailable.
- **It doesn't just say no.** The output includes where a discount does pay: cancel-flow save offers (by cancel reason, kept near your pre-increase price, tested against a holdout), dunning, and the early-tenure window for the annual plan you already sell.

## Author

[Matthias Lugert](https://github.com/matlugert)

## License

MIT
