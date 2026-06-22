'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateTaxLiability,
    calculateScheduleCModule,
    getSaltCap,
    compareScenarios,
    analyzeRothConversion,
    analyzeCapitalGainHarvesting
} = require('./tax-engine.js');

function scenario(overrides = {}) {
    return {
        filingStatus: 'Single',
        stateModule: 'none',
        ageSelf: 40,
        ageSpouse: 40,
        ...overrides
    };
}

function business(overrides = {}) {
    return {
        id: 'business-1',
        name: 'Consulting',
        owner: 'taxpayer',
        grossReceipts: 0,
        returnsAllowances: 0,
        costOfGoodsSold: 0,
        otherIncome: 0,
        expenseMode: 'total',
        totalExpenses: 0,
        qualifiedTipsIncluded: 0,
        qbiEligibility: 'eligible',
        isSstb: 'no',
        ...overrides
    };
}

function assertClose(actual, expected, tolerance = 0.01) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('calculates the 2026 single-filer ordinary brackets', () => {
    const result = calculateTaxLiability(scenario({ wages: 100000 }));

    assert.equal(result.finalAGI, 100000);
    assert.equal(result.taxableIncome, 83900);
    assert.equal(result.ordinaryTax, 13170);
});

test('Schedule 1-A deductions reduce taxable income without reducing AGI', () => {
    const result = calculateTaxLiability(scenario({ wages: 100000, tips: 10000 }));

    assert.equal(result.finalAGI, 110000);
    assert.equal(result.deductibleTips, 10000);
    assert.equal(result.additionalDeductions, 10000);
    assert.equal(result.taxableIncome, 83900);
});

test('enhanced senior deduction remains available to an itemizer', () => {
    const result = calculateTaxLiability(scenario({
        ageSelf: 65,
        wages: 100000,
        salt: 20000,
        mortgageInterest: 10000
    }));

    assert.equal(result.usedStandard, false);
    assert.equal(result.finalDeduction, 30000);
    assert.equal(result.seniorBonus, 4500);
    assert.equal(result.taxableIncome, 65500);
});

test('applies the 2026 SALT cap phase-down and floor', () => {
    assert.equal(getSaltCap(505000), 40400);
    assert.equal(getSaltCap(600000), 11900);
    assert.equal(getSaltCap(700000), 10000);
});

test('dependent credit phase-out uses AGI before Schedule 1-A deductions', () => {
    const result = calculateTaxLiability(scenario({
        wages: 205000,
        tips: 10000,
        childDependents: 1
    }));

    assert.equal(result.finalAGI, 215000);
    assert.equal(result.deductibleTips, 3500);
    assert.equal(result.totalCredits, 1450);
});

test('qualified overtime input is capped at the joint-return limit', () => {
    const result = calculateTaxLiability(scenario({
        filingStatus: 'MFJ',
        wages: 100000,
        overtime: 30000
    }));

    assert.equal(result.finalAGI, 130000);
    assert.equal(result.deductibleOT, 25000);
    assert.equal(result.taxableIncome, 72800);
});

test('qualified auto interest reduces taxable income rather than AGI', () => {
    const result = calculateTaxLiability(scenario({
        wages: 80000,
        autoLoanInterest: 5000,
        isUSCar: true
    }));

    assert.equal(result.finalAGI, 80000);
    assert.equal(result.deductibleAuto, 5000);
    assert.equal(result.taxableIncome, 58900);
});

test('compares federal, state, and combined scenario outcomes', () => {
    const comparison = compareScenarios(
        scenario({ wages: 100000, stateModule: 'AZ' }),
        scenario({ wages: 100000, stateModule: 'AZ', iraContrib: 5000 })
    );

    assert.equal(comparison.agiDelta, -5000);
    assert.ok(comparison.federalTaxDelta < 0);
    assert.ok(comparison.stateTaxDelta < 0);
    assert.equal(
        comparison.combinedTaxDelta,
        comparison.federalTaxDelta + comparison.stateTaxDelta
    );
});

test('finds Roth conversion room by recalculating the full tax engine', () => {
    const analysis = analyzeRothConversion(
        scenario({ wages: 100000 }),
        { targetRate: 'current' }
    );

    assert.equal(analysis.targetRate, 0.22);
    assert.equal(analysis.room, 21800);
    assert.equal(analysis.federalTaxCost, 4796);
    assert.equal(analysis.nextFederalRate, 0.22);
});

test('Roth conversion search accounts for additional taxable Social Security', () => {
    const values = scenario({
        socialSecurity: 30000,
        iraRegular: 20000
    });
    const base = calculateTaxLiability(values);
    const analysis = analyzeRothConversion(values, { targetRate: 'current' });
    const staticBracketGap = base.currentBracket.max - base.ordinaryIncome;

    assert.ok(analysis.room < staticBracketGap);
    assert.equal(analysis.targetResult.currentBracket.rate, analysis.targetRate);
});

test('finds long-term gain room remaining in the 0% LTCG band', () => {
    const analysis = analyzeCapitalGainHarvesting(
        scenario({ wages: 40000 }),
        { targetRate: 0 }
    );

    assert.equal(analysis.room, 25550);
    assert.equal(analysis.directLtcgTaxCost, 0);
    assert.equal(analysis.federalTaxCost, 0);
    assert.equal(analysis.targetResult.taxableIncome, 49450);
});

test('separates Social Security interactions from direct 0% LTCG tax', () => {
    const analysis = analyzeCapitalGainHarvesting(
        scenario({ socialSecurity: 30000, iraRegular: 20000 }),
        { targetRate: 0 }
    );
    const staticTaxableIncomeGap = analysis.targetThreshold - analysis.baseResult.taxableIncome;

    assert.ok(analysis.room < staticTaxableIncomeGap);
    assert.equal(analysis.directLtcgTaxCost, 0);
    assert.ok(analysis.taxableSSIncrease > 0);
    assert.ok(analysis.federalInteractionCost > 0);
});

test('finds room through the top of the 15% LTCG band', () => {
    const analysis = analyzeCapitalGainHarvesting(
        scenario({ wages: 100000 }),
        { targetRate: 0.15 }
    );

    assert.equal(analysis.room, 461600);
    assert.equal(analysis.targetResult.taxableIncome, 545500);
    assert.equal(analysis.directLtcgTaxCost, 69240);
});

test('calculates Schedule C profit, regular SE tax, and the half-SE-tax deduction', () => {
    const result = calculateTaxLiability(scenario({
        scheduleCBusinesses: [business({ grossReceipts: 100000, totalExpenses: 20000 })]
    }));

    assert.equal(result.scheduleC.totalNetProfit, 80000);
    assertClose(result.scheduleC.totalNetEarnings, 73880);
    assertClose(result.regularSelfEmploymentTax, 11303.64);
    assertClose(result.scheduleC.deductibleHalfSelfEmploymentTax, 5651.82);
    assertClose(result.finalAGI, 74348.18);
    assertClose(result.totalFederalTax, result.incomeTaxEstimate + 11303.64);
});

test('coordinates Social Security SE tax with owner W-2 Box 3 wages', () => {
    const module = calculateScheduleCModule({
        scheduleCBusinesses: [business({ grossReceipts: 100000, totalExpenses: 20000 })],
        selfEmploymentOwners: {
            taxpayer: { socialSecurityWages: 180000, medicareWages: 180000 }
        }
    }, 'Single');

    assert.equal(module.owners.taxpayer.remainingSocialSecurityBase, 4500);
    assertClose(module.owners.taxpayer.socialSecurityTax, 558);
    assertClose(module.owners.taxpayer.medicareTax, 2142.52);
});

test('nets multiple businesses for one owner but keeps spouse SE earnings separate', () => {
    const module = calculateScheduleCModule({
        scheduleCBusinesses: [
            business({ id: 'profit', grossReceipts: 100000, totalExpenses: 20000 }),
            business({ id: 'loss', grossReceipts: 10000, totalExpenses: 30000 }),
            business({ id: 'spouse', owner: 'spouse', grossReceipts: 25000, totalExpenses: 5000 })
        ]
    }, 'MFJ');

    assert.equal(module.owners.taxpayer.netProfit, 60000);
    assertClose(module.owners.taxpayer.netEarnings, 55410);
    assert.equal(module.owners.spouse.netProfit, 20000);
    assertClose(module.owners.spouse.netEarnings, 18470);
});

test('excludes spouse businesses outside a joint return', () => {
    const module = calculateScheduleCModule({
        scheduleCBusinesses: [business({ owner: 'spouse', grossReceipts: 50000 })]
    }, 'Single');

    assert.equal(module.totalNetProfit, 0);
    assert.equal(module.invalidSpouseBusinesses.length, 1);
});

test('calculates Additional Medicare Tax from Box 5 wages and net SE earnings', () => {
    const result = calculateTaxLiability(scenario({
        scheduleCBusinesses: [business({ grossReceipts: 30000 })],
        selfEmploymentOwners: {
            taxpayer: { socialSecurityWages: 190000, medicareWages: 190000 }
        }
    }));

    assertClose(result.additionalMedicareTax, 159.345);
});

test('applies the guarded QBI estimate and OBBBA minimum deduction', () => {
    const result = calculateTaxLiability(scenario({
        wages: 20000,
        scheduleCBusinesses: [business({ grossReceipts: 1500 })]
    }));

    assert.equal(result.qbiReviewRequired, false);
    assert.equal(result.qbiDeduction, 400);
});

test('uses conservative zero QBI above the 2026 limitation threshold', () => {
    const result = calculateTaxLiability(scenario({
        wages: 250000,
        scheduleCBusinesses: [business({ grossReceipts: 50000 })]
    }));

    assert.equal(result.qbiReviewRequired, true);
    assert.equal(result.qbiDeduction, 0);
    assert.ok(result.potentialQbiDeduction > 0);
});

test('business tips are not double-counted and are limited by business profit', () => {
    const result = calculateTaxLiability(scenario({
        scheduleCBusinesses: [business({
            grossReceipts: 30000,
            totalExpenses: 20000,
            qualifiedTipsIncluded: 15000
        })]
    }));

    assert.equal(result.scheduleC.totalNetProfit, 10000);
    assert.equal(result.scheduleC.eligibleBusinessTips, 10000);
    assert.equal(result.deductibleTips, 10000);
    assert.ok(result.totalRealIncome < 30000);
});

test('SSTB business tips are excluded from Schedule 1-A', () => {
    const result = calculateTaxLiability(scenario({
        scheduleCBusinesses: [business({ grossReceipts: 30000, qualifiedTipsIncluded: 10000, isSstb: 'yes' })]
    }));

    assert.equal(result.scheduleC.eligibleBusinessTips, 0);
    assert.equal(result.deductibleTips, 0);
});

test('sums optional Schedule C expense groups', () => {
    const module = calculateScheduleCModule({
        scheduleCBusinesses: [business({
            grossReceipts: 50000,
            expenseMode: 'grouped',
            totalExpenses: 99999,
            expenses: {
                labor: 5000,
                vehicleTravel: 2000,
                officeSoftware: 1000,
                rentUtilities: 3000,
                insuranceProfessional: 1500,
                depreciationSection179: 2500,
                other: 1000
            }
        })]
    }, 'Single');

    assert.equal(module.totalExpenses, 16000);
    assert.equal(module.totalNetProfit, 34000);
});

test('allows Schedule C losses without generating self-employment tax', () => {
    const result = calculateTaxLiability(scenario({
        wages: 80000,
        scheduleCBusinesses: [business({ grossReceipts: 10000, totalExpenses: 30000 })]
    }));

    assert.equal(result.scheduleC.totalNetProfit, -20000);
    assert.equal(result.scheduleC.totalNetEarnings, 0);
    assert.equal(result.regularSelfEmploymentTax, 0);
    assert.equal(result.finalAGI, 60000);
});

test('applies the Schedule SE filing threshold after the 92.35% factor', () => {
    const belowThreshold = calculateScheduleCModule({
        scheduleCBusinesses: [business({ grossReceipts: 433 })]
    }, 'Single');
    const atThreshold = calculateScheduleCModule({
        scheduleCBusinesses: [business({ grossReceipts: 434 })]
    }, 'Single');

    assert.equal(belowThreshold.owners.taxpayer.netEarnings, 0);
    assert.ok(atThreshold.owners.taxpayer.netEarnings >= 400);
    assert.ok(atThreshold.regularSelfEmploymentTax > 0);
});

test('owner health and retirement entries reduce AGI, provisional income, and QBI', () => {
    const baseValues = scenario({
        socialSecurity: 30000,
        scheduleCBusinesses: [business({ grossReceipts: 50000, totalExpenses: 10000 })]
    });
    const unadjusted = calculateTaxLiability(baseValues);
    const adjusted = calculateTaxLiability({
        ...baseValues,
        selfEmploymentOwners: {
            taxpayer: { healthInsurance: 5000, retirementPlan: 5000 }
        }
    });

    assertClose(unadjusted.finalAGI - adjusted.finalAGI, 18500);
    assert.ok(adjusted.taxableSS < unadjusted.taxableSS);
    assertClose(unadjusted.adjustedQbi - adjusted.adjustedQbi, 10000);
});

test('reduces QBI by a prior-year qualified business loss carryforward', () => {
    const result = calculateTaxLiability(scenario({
        wages: 50000,
        priorYearQbiLossCarryforward: 15000,
        scheduleCBusinesses: [business({ grossReceipts: 50000, totalExpenses: 10000 })]
    }));

    assertClose(result.adjustedQbi, 22174.09);
    assertClose(result.qbiDeduction, 4434.818);
});

test('flows Schedule C income and deductions into Arizona and California AGI', () => {
    const federalOnly = calculateTaxLiability(scenario({
        scheduleCBusinesses: [business({ grossReceipts: 60000, totalExpenses: 10000 })]
    }));
    const arizona = calculateTaxLiability(scenario({
        stateModule: 'AZ',
        scheduleCBusinesses: [business({ grossReceipts: 60000, totalExpenses: 10000 })]
    }));
    const california = calculateTaxLiability(scenario({
        stateModule: 'CA',
        scheduleCBusinesses: [business({ grossReceipts: 60000, totalExpenses: 10000 })]
    }));

    assertClose(arizona.finalAGI, federalOnly.finalAGI);
    assertClose(california.caAgi, federalOnly.finalAGI);
    assert.ok(arizona.azTax > 0);
    assert.ok(california.caTax > 0);
});

test('flows qualified tips to Arizona while California keeps them federal-only', () => {
    const azWagesOnly = calculateTaxLiability(scenario({ stateModule: 'AZ', wages: 100000 }));
    const azWithTips = calculateTaxLiability(scenario({
        stateModule: 'AZ',
        wages: 90000,
        employeeQualifiedTips: 10000
    }));
    const caWagesOnly = calculateTaxLiability(scenario({ stateModule: 'CA', wages: 100000 }));
    const caWithTips = calculateTaxLiability(scenario({
        stateModule: 'CA',
        wages: 90000,
        employeeQualifiedTips: 10000
    }));

    assert.equal(azWithTips.deductibleTips, 10000);
    assert.equal(azWithTips.finalAGI, azWagesOnly.finalAGI);
    assertClose(azWagesOnly.stateResult.adjustedGrossIncome - azWithTips.stateResult.adjustedGrossIncome, 10000);
    assert.ok(azWithTips.azTax < azWagesOnly.azTax);
    assert.equal(caWithTips.deductibleTips, 10000);
    assert.equal(caWithTips.finalAGI, caWagesOnly.finalAGI);
    assertClose(caWithTips.caTax, caWagesOnly.caTax);
    assert.ok(azWithTips.incomeTaxEstimate < azWagesOnly.incomeTaxEstimate);
});

test('flows federal qualified overtime and senior deductions to Arizona but not auto interest', () => {
    const result = calculateTaxLiability(scenario({
        stateModule: 'AZ',
        filingStatus: 'Single',
        wages: 100000,
        overtime: 5000,
        ageSelf: 65,
        autoLoanInterest: 3000,
        isUSCar: true
    }));

    assert.equal(result.azQualifiedOvertimeSubtraction, result.deductibleOT);
    assert.equal(result.azSeniorSubtraction, result.seniorBonus);
    assert.ok(result.deductibleAuto > 0);
    assert.equal(result.stateResult.subtractions, result.deductibleOT + result.seniorBonus);
});

test('Colorado inherits federal below-AGI deductions through federal taxable income', () => {
    const wagesOnly = calculateTaxLiability(scenario({ stateModule: 'CO', wages: 100000 }));
    const wagesAndTips = calculateTaxLiability(scenario({
        stateModule: 'CO',
        wages: 90000,
        employeeQualifiedTips: 10000
    }));

    assert.equal(wagesAndTips.finalAGI, wagesOnly.finalAGI);
    assertClose(wagesOnly.taxableIncome - wagesAndTips.taxableIncome, 10000);
    assertClose(wagesOnly.stateResult.taxableIncome - wagesAndTips.stateResult.taxableIncome, 10000);
    assert.ok(wagesAndTips.stateResult.tax < wagesOnly.stateResult.tax);
});

test('Virginia and Ohio retain the federal-AGI starting point for Schedule 1-A deductions', () => {
    for (const stateModule of ['VA', 'OH']) {
        const wagesOnly = calculateTaxLiability(scenario({ stateModule, wages: 100000 }));
        const wagesAndTips = calculateTaxLiability(scenario({
            stateModule,
            wages: 90000,
            employeeQualifiedTips: 10000
        }));

        assert.equal(wagesAndTips.finalAGI, wagesOnly.finalAGI);
        assertClose(wagesAndTips.stateResult.tax, wagesOnly.stateResult.tax);
    }
});

test('Ohio returns a guarded simple business-income estimate for Schedule C profit', () => {
    const result = calculateTaxLiability(scenario({
        stateModule: 'OH',
        wages: 100000,
        scheduleCBusinesses: [business({ grossReceipts: 300000 })]
    }));

    assert.equal(result.stateResult.details.businessIncomeDeduction, 250000);
    assert.ok(result.stateResult.details.taxableBusinessIncome > 0);
    assert.equal(result.stateResult.details.businessReviewRequired, true);
    assert.equal(result.stateResult.details.localTaxReviewRequired, true);
});

test('keeps the QBI deduction federal-only for Arizona and California', () => {
    for (const stateModule of ['AZ', 'CA']) {
        const values = scenario({
            stateModule,
            wages: 30000,
            scheduleCBusinesses: [business({ grossReceipts: 60000, totalExpenses: 10000 })]
        });
        const eligible = calculateTaxLiability(values);
        const ineligible = calculateTaxLiability({
            ...values,
            scheduleCBusinesses: [{ ...values.scheduleCBusinesses[0], qbiEligibility: 'notEligible' }]
        });
        const stateTaxKey = stateModule === 'AZ' ? 'azTax' : 'caTax';

        assert.ok(eligible.qbiDeduction > 0);
        assert.equal(ineligible.qbiDeduction, 0);
        assertClose(eligible.finalAGI, ineligible.finalAGI);
        assertClose(eligible[stateTaxKey], ineligible[stateTaxKey]);
        assert.ok(eligible.incomeTaxEstimate < ineligible.incomeTaxEstimate);
    }
});

test('flows the deductible half of SE tax through each state AGI calculation', () => {
    for (const stateModule of ['AZ', 'CA']) {
        const values = scenario({
            stateModule,
            wages: 184500,
            scheduleCBusinesses: [business({ grossReceipts: 60000, totalExpenses: 10000 })]
        });
        const noBoxThreeWages = calculateTaxLiability(values);
        const wageBaseUsed = calculateTaxLiability({
            ...values,
            selfEmploymentOwners: {
                taxpayer: { socialSecurityWages: 184500, medicareWages: 184500 }
            }
        });
        const stateTaxKey = stateModule === 'AZ' ? 'azTax' : 'caTax';
        const halfSeDifference = noBoxThreeWages.scheduleC.deductibleHalfSelfEmploymentTax -
            wageBaseUsed.scheduleC.deductibleHalfSelfEmploymentTax;

        assertClose(wageBaseUsed.finalAGI - noBoxThreeWages.finalAGI, halfSeDifference);
        assert.ok(wageBaseUsed[stateTaxKey] > noBoxThreeWages[stateTaxKey]);
    }
});

test('keeps Additional Medicare Tax out of state income tax', () => {
    for (const stateModule of ['AZ', 'CA']) {
        const values = scenario({
            filingStatus: 'MFJ',
            stateModule,
            wages: 260000,
            scheduleCBusinesses: [business({ grossReceipts: 30000 })]
        });
        const withoutBoxFive = calculateTaxLiability(values);
        const withBoxFive = calculateTaxLiability({
            ...values,
            selfEmploymentOwners: {
                taxpayer: { socialSecurityWages: 0, medicareWages: 260000 }
            }
        });
        const stateTaxKey = stateModule === 'AZ' ? 'azTax' : 'caTax';

        assert.equal(withoutBoxFive.additionalMedicareTax, 0);
        assert.ok(withBoxFive.additionalMedicareTax > 0);
        assertClose(withBoxFive.finalAGI, withoutBoxFive.finalAGI);
        assertClose(withBoxFive[stateTaxKey], withoutBoxFive[stateTaxKey]);
        assert.ok(withBoxFive.totalFederalTax > withoutBoxFive.totalFederalTax);
    }
});

test('removes taxable Social Security from both supported state calculations', () => {
    for (const stateModule of ['AZ', 'CA']) {
        const withoutBenefits = calculateTaxLiability(scenario({ stateModule, iraRegular: 40000 }));
        const withBenefits = calculateTaxLiability(scenario({
            stateModule,
            iraRegular: 40000,
            socialSecurity: 30000
        }));
        const stateTaxKey = stateModule === 'AZ' ? 'azTax' : 'caTax';

        assert.ok(withBenefits.taxableSS > 0);
        assertClose(withBenefits[stateTaxKey], withoutBenefits[stateTaxKey]);
    }
});

test('stops Roth and capital-gain searches at the advanced QBI guardrail', () => {
    const values = scenario({
        wages: 170000,
        scheduleCBusinesses: [business({ grossReceipts: 50000, totalExpenses: 10000 })]
    });
    const roth = analyzeRothConversion(values, { targetRate: 0.35 });
    const gains = analyzeCapitalGainHarvesting(values, { targetRate: 0.15 });

    assert.equal(roth.qbiReviewRequired, true);
    assert.equal(gains.qbiReviewRequired, true);
    assert.equal(roth.targetResult.qbiReviewRequired, false);
    assert.equal(gains.targetResult.qbiReviewRequired, false);
});
