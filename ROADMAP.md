# Development Queue

## 1. Schedule C and Self-Employment Income

Status: Queued

- Add Schedule C gross receipts and deductible business expenses.
- Calculate net Schedule C profit or loss.
- Calculate self-employment tax, including Social Security and Medicare components.
- Coordinate Social Security wage-base usage with W-2 wages.
- Add the deductible half of self-employment tax to federal AGI adjustments.
- Model Additional Medicare Tax where applicable.
- Add qualified business income considerations and clearly identify unsupported limitations.
- Coordinate self-employed qualified tips with Schedule 1-A eligibility and limits.
- Flow Schedule C income and adjustments into each supported state module.
- Add calculation tests for profit, loss, mixed W-2/Schedule C income, and married filing jointly scenarios.

## 2. Expand State Coverage

Status: Queued

- Extract a reusable state-module contract for income adjustments, deductions, credits, and tax calculations.
- Add source and tax-year metadata to every state module.
- Show whether a state result is final, projected, or partially modeled.
- Add state-specific calculation fixtures before enabling a state in the interface.
- Prioritize new states based on advisor and client demand.
- Preserve Federal Only, Arizona, and California behavior while the framework evolves.

## Release Standard

Every queued module should include primary-source documentation, calculation tests, interface guidance, and a clearly stated list of exclusions before it is published.
