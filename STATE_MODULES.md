# State Module Framework

State calculations consume federal adjusted gross income and return one shared result contract. Each enabled state must provide:

- State code, display name, tax year, confidence status, and official source URLs.
- State adjusted gross income, additions, subtractions, deduction, taxable income, credits, and tax.
- State-specific calculation details needed by the interface.
- Calculation fixtures for ordinary income, retirement income, Schedule C income, federal-only deductions, and scenario analyzers.

## Current Status

### Arizona

- Status: 2026 projected planning estimate.
- Official source locations: [Arizona individual income tax forms](https://azdor.gov/forms/individual/individual-income-tax-forms) and [Arizona Department of Revenue individual guidance](https://azdor.gov/individuals).
- Existing assumptions are preserved pending publication and review of final 2026 Form 140 instructions.

### California

- Status: 2026 projected planning estimate.
- Official source locations: [California tax forms](https://www.ftb.ca.gov/forms/index.html) and [California tax tables and rates](https://www.ftb.ca.gov/file/personal/tax-calculator-tables-rates.asp).
- Existing projected brackets, deductions, and exemption credits are preserved pending publication and review of final 2026 Form 540 instructions and schedules.

## Release Gate

Before a state changes from projected to final, verify every amount against the tax-year instructions and retain fixtures for the published examples. A new state remains disabled until its metadata, official sources, calculation adapter, interface inputs, and regression tests are complete.
