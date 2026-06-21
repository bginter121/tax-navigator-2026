# Tax Navigator 2026

Advisor-facing federal, Arizona, and California tax planning calculator for 2026.

## Project Structure

- `index.html` contains the GitHub Pages interface and client-side interactions.
- `tax-engine.js` contains the calculation rules and can run without the interface.
- `state-modules.js` contains the shared state contract and individual state adapters.
- `tax-engine.test.js` contains focused calculation scenarios.
- `state-modules.test.js` validates state metadata and the shared adapter contract.

The site remains fully static: it does not require a server, database, or build step.

## Planning Studio

- Capture the current entries as a named baseline.
- Edit the live form as the proposed plan and compare federal, state, combined tax, AGI, and taxable income.
- Restore or clear the baseline at any time.
- Save and load baseline metadata with the existing client JSON file.
- Analyze additional Roth conversion room by repeatedly running the full tax engine against a selected federal bracket.
- Analyze capital-gain harvesting room through the 0% or 15% LTCG band, with direct gain tax separated from taxable Social Security and other interactions.
- Model multiple taxpayer and spouse Schedule C businesses, owner-level self-employment taxes, entered owner deductions, qualified business tips, and guarded QBI estimates.

Scenario Studio browser storage stays on the local device and is not transmitted by the application.

## Schedule C Planning

Schedule C is a planning summary for sole proprietors and gig work. It supports total or grouped expenses, losses, W-2 wage-base coordination, Additional Medicare Tax, qualified business tips, and schema-version-2 client files. Existing version-1 files remain loadable.

The module does not determine basis, at-risk, passive-activity, excess-business-loss, health-insurance eligibility, retirement contribution limits, or advanced QBI wage/property/SSTB limitations. Above the 2026 QBI threshold, it applies no QBI deduction and marks the return for review.

State source status and the adapter release gate are documented in `STATE_MODULES.md`. Further planned work is tracked in `ROADMAP.md`.

## Verification

Run the calculation checks with Node.js:

```text
node --test
```

## Source Preservation

The untouched Gemini version is preserved at commit `25ce5cb` in both:

- Branch: `archive/gemini-original-2026-02-26`
- Tag: `gemini-original-2026-02-26`

Ongoing Tax Planning Studio work lives on `codex/tax-planning-studio`.

## Primary Federal Sources

- IRS Revenue Procedure 2025-32 for 2026 inflation-adjusted amounts
- IRS Schedule 1-A guidance for additional deductions
- IRS One Big Beautiful Bill provisions for individuals and workers
- IRS Publication 15 for the 2026 Social Security wage base
- IRS Topic 560 for Additional Medicare Tax
- IRS Self-Employed Individuals Tax Center and Schedule SE guidance
- Public Law 119-21 for the 2026 SALT limitation and phase-down
