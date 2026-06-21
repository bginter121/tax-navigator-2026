# Tax Navigator 2026

Advisor-facing federal, Arizona, and California tax planning calculator for 2026.

## Project Structure

- `index.html` contains the GitHub Pages interface and client-side interactions.
- `tax-engine.js` contains the calculation rules and can run without the interface.
- `tax-engine.test.js` contains focused calculation scenarios.

The site remains fully static: it does not require a server, database, or build step.

## Verification

Run the calculation checks with Node.js:

```text
node --test tax-engine.test.js
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
- Public Law 119-21 for the 2026 SALT limitation and phase-down
