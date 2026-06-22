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

### Colorado

- Status: 2026 focused planning estimate for full-year residents.
- Starts with federal taxable income and applies a projected 4.4% state rate.
- Automatically removes entered U.S. government interest. Colorado pension/annuity, 529, and state-income-tax itemized adjustments are advisor-entered because the available federal inputs do not establish the allowed state amounts.
- State credits, specialized additions, part-year/nonresident allocation, and return-level limitations outside the displayed adjustments are not modeled.
- Official source locations: [Colorado individual income tax guide](https://tax.colorado.gov/individual-income-tax-guide) and [Colorado individual forms](https://tax.colorado.gov/individual-income-tax-forms).

### Virginia

- Status: 2026 focused planning estimate for full-year residents.
- Starts with federal adjusted gross income; removes federally taxable Social Security and entered U.S. government interest; and uses Virginia's progressive 2% through 5.75% rate schedule.
- Uses projected 2026 standard deductions of $8,750 for Single/HOH and $17,500 for MFJ, plus personal, dependent, age, and blindness exemptions.
- Age, eligible military-retirement, 529, and adjusted itemized amounts are advisor-entered. The interface flags a deduction-method mismatch when the federal return itemizes without a Virginia itemized amount, or vice versa.
- State credits, specialized additions, part-year/nonresident allocation, and detailed age-deduction eligibility are not modeled.
- Official source locations: [Virginia individual income tax](https://www.tax.virginia.gov/individual-income-tax) and [Virginia Form 760 search](https://www.tax.virginia.gov/forms/search?search=760).

### Ohio

- Status: 2026 conditional, state-only estimate for full-year residents.
- Starts with federal adjusted gross income and uses a projected 2.75% nonbusiness rate. A simple Schedule C-only business estimate applies the first $250,000 business-income deduction and a 3% rate to remaining business income.
- Removes federally taxable Social Security and entered U.S. government interest. Eligible military-retirement and 529 deductions are advisor-entered. Income-based personal and dependent exemptions are included.
- Every Ohio result warns that municipal and school-district income taxes are excluded. A nonzero Schedule C result adds a business-review warning because other business income, losses, apportionment, and detailed Ohio adjustments are not modeled.
- State credits, specialized additions, part-year/nonresident allocation, municipal tax, and school-district tax are not modeled.
- Official source locations: [Ohio individual income tax](https://tax.ohio.gov/individual) and [Ohio Revised Code Chapter 5747](https://codes.ohio.gov/ohio-revised-code/chapter-5747).

### Tennessee

- Status: supported 2026 no-individual-income-tax result.
- Tennessee repealed the Hall income tax for tax periods beginning January 1, 2021 or later, so the module returns zero individual state income tax.
- A nonzero Schedule C result adds a review warning for separate franchise, excise, business, and local taxes, especially when the activity is operated through an LLC or another entity. Those taxes are not calculated by this individual module.
- Official source locations: [Tennessee Hall income tax](https://www.tn.gov/revenue/taxes/hall-income-tax.html) and [Tennessee franchise and excise tax](https://www.tn.gov/revenue/taxes/franchise---excise-tax.html).

### South Carolina

- Status: guarded 2026 projection using published 2025 law; revalidation required.
- Starts with federal taxable income and uses the published 2025 brackets: 0% through $3,560, 3% through $17,830, and 6% above $17,830.
- Automatically removes federally taxable Social Security, entered U.S. government interest, and 44% of qualifying net capital gain. Qualifying gain is limited to entered net long-term gain reduced by any entered net short-term loss.
- State-income-tax itemized add-back, qualifying retirement income, coordinated age-65, military retirement, and eligible Future Scholar or SC Tuition Prepayment deductions are advisor-entered.
- A nonzero Schedule C result triggers Form I-335 review. The active-trade-or-business reduced rate is not applied, so the projection may overstate tax for qualifying business income.
- State credits, specialized additions, part-year/nonresident allocation, and the I-335 active-business calculation are not modeled.
- South Carolina's 2026 IRC conformity, brackets, and final instructions must be revalidated before the module is treated as final. The interface displays this warning on every result.
- Official source locations: [South Carolina individual income tax](https://dor.sc.gov/iit), [South Carolina individual FAQs](https://dor.sc.gov/iit/prepare-you-file/iit-faqs), [2025 tax tables](https://dor.sc.gov/sites/dor/files/forms/SC1040TT_2025.pdf), [2026 conformity notice](https://dor.sc.gov/news/scdor-statement-income-tax-conformity-april-15-filing-deadline-extended-sc-returns), and [Form I-335 search](https://dor.sc.gov/find-a-form?search_api_fulltext=I-335).

The Virginia and Ohio official sites were unreachable during the initial 2026 planning pass. Their projected dollar amounts and rates must be revalidated against accessible enacted law and final instructions before either module is promoted beyond planning status.

## Release Gate

Before a state changes from projected to final, verify every amount against the tax-year instructions and retain fixtures for the published examples. Planning-tier states may be enabled when metadata, official source locations, calculation fixtures, interface guidance, exclusions, and review guardrails are complete.
