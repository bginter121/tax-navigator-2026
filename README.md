# Tax Navigator 2026

Advisor-facing federal, Arizona, and California tax planning calculator for 2026.

## Project Structure

- `index.html` contains the GitHub Pages interface and client-side interactions.
- `tax-engine.js` contains the calculation rules and can run without the interface.
- `tax-engine.test.js` contains focused calculation scenarios.

The site remains fully static: it does not require a server, database, or build step.

## Planning Studio

- Capture the current entries as a named baseline.
- Edit the live form as the proposed plan and compare federal, state, combined tax, AGI, and taxable income.
- Restore or clear the baseline at any time.
- Save and load baseline metadata with the existing client JSON file.
- Analyze additional Roth conversion room by repeatedly running the full tax engine against a selected federal bracket.

Scenario Studio browser storage stays on the local device and is not transmitted by the application.

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
- Public Law 119-21 for the 2026 SALT limitation and phase-down
