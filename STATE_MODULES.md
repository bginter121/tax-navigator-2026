# State Module Framework

State calculations consume federal adjusted gross income and return one shared result contract. Each enabled state must provide:

- State code, display name, tax year, confidence status, and official source URLs.
- State adjusted gross income, additions, subtractions, deduction, taxable income, credits, and tax.
- State-specific calculation details needed by the interface.
- Calculation fixtures for ordinary income, retirement income, Schedule C income, federal-only deductions, and scenario analyzers.

## Current Status

### Arizona

- Status: 2026 HB 4168 legislation modeled; Arizona Department of Revenue guidance pending.
- Legislative basis: the House-engrossed HB 4168 text supplied for review, including A.R.S. sections 43-1021, 43-1022, 43-1041, 43-1042, and 43-1073.01. Official source locations include the [Arizona Legislature bill text](https://www.azleg.gov/legtext/57leg/2R/bills/HB4168H.pdf), [Arizona individual income tax forms](https://azdor.gov/forms/individual/individual-income-tax-forms), and [Arizona Department of Revenue individual guidance](https://azdor.gov/individuals).
- Modeled 2026 changes include federal-linked qualified tip, overtime, and enhanced senior subtractions; IRC 530A and dependent-care-excess subtractions; the IRC 168(n) production-property depreciation add-back; revised charity and SALT deduction limits; and the $125 under-17 dependent credit.
- Qualified auto-loan interest is not an Arizona subtraction for 2026 because the Arizona provision in the reviewed bill applies only through December 31, 2025.
- IRC 530A distributions, dependent-care expense excess, and qualified-production-property depreciation are advisor-entered because the calculator does not have enough underlying data to derive them safely.
- The reviewed text does not state a charitable standard-deduction cap for head-of-household filers. The planning module conservatively uses the $1,000 non-joint cap pending ADOR guidance.
- Final line placement, terminology, and any administrative interpretation remain subject to the 2026 Form 140 instructions.

### California

- Status: 2026 projected planning estimate.
- Official source locations: [California tax forms](https://www.ftb.ca.gov/forms/index.html) and [California tax tables and rates](https://www.ftb.ca.gov/file/personal/tax-calculator-tables-rates.asp).
- Existing projected brackets, deductions, and exemption credits are preserved pending publication and review of final 2026 Form 540 instructions and schedules.

## Release Gate

Before a state changes from projected to final, verify every amount against the tax-year instructions and retain fixtures for the published examples. A new state remains disabled until its metadata, official sources, calculation adapter, interface inputs, and regression tests are complete.
