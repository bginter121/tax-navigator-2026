'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STATE_MODULE_METADATA,
    calculateStateModule
} = require('./state-modules.js');

function context(overrides = {}) {
    return {
        values: {},
        filingStatus: 'Single',
        isMFJ: false,
        ageCount: 0,
        blindCount: 0,
        taxableSS: 0,
        federalAGI: 100000,
        federalTaxableIncome: 80000,
        federalStandardDeduction: 16100,
        usedStandard: true,
        scheduleC: { totalNetProfit: 0 },
        ...overrides
    };
}

test('every enabled state publishes planning metadata and official sources', () => {
    for (const code of ['AZ', 'CA', 'CO', 'VA', 'OH', 'TN', 'SC']) {
        const metadata = STATE_MODULE_METADATA[code];

        assert.equal(metadata.code, code);
        assert.equal(metadata.taxYear, 2026);
        assert.ok(metadata.sources.length > 0);
        metadata.sources.forEach(source => assert.match(source, /^https:\/\//));
    }

    assert.equal(STATE_MODULE_METADATA.AZ.status, 'legislation-modeled');
    assert.match(STATE_MODULE_METADATA.AZ.statusLabel, /HB 4168 modeled/i);
    assert.equal(STATE_MODULE_METADATA.CA.status, 'projected');
    assert.match(STATE_MODULE_METADATA.CA.statusLabel, /projected planning estimate/i);
    assert.equal(STATE_MODULE_METADATA.CO.status, 'planning-estimate');
    assert.equal(STATE_MODULE_METADATA.VA.status, 'planning-estimate');
    assert.equal(STATE_MODULE_METADATA.OH.status, 'conditional-estimate');
    assert.match(STATE_MODULE_METADATA.OH.statusLabel, /local tax excluded/i);
    assert.equal(STATE_MODULE_METADATA.TN.status, 'no-individual-income-tax');
    assert.match(STATE_MODULE_METADATA.TN.statusLabel, /no Tennessee individual income tax/i);
    assert.equal(STATE_MODULE_METADATA.SC.status, 'revalidation-required');
    assert.match(STATE_MODULE_METADATA.SC.statusLabel, /2025 law.*revalidation required/i);
});

test('all state adapters return the shared result contract', () => {
    const requiredKeys = [
        'code', 'name', 'taxYear', 'status', 'statusLabel', 'sources',
        'tax', 'adjustedGrossIncome', 'taxableIncome', 'deduction',
        'credits', 'additions', 'subtractions', 'details'
    ];

    for (const code of ['none', 'AZ', 'CA', 'CO', 'VA', 'OH', 'TN', 'SC']) {
        const result = calculateStateModule(code, context());
        requiredKeys.forEach(key => assert.ok(Object.prototype.hasOwnProperty.call(result, key), `${code} missing ${key}`));
        assert.equal(result.code, code);
        assert.ok(Number.isFinite(result.tax));
    }
});

test('unknown state codes safely return the federal-only adapter', () => {
    const result = calculateStateModule('XX', context());

    assert.equal(result.code, 'none');
    assert.equal(result.tax, 0);
});

test('Arizona adapter exposes its state-specific details', () => {
    const result = calculateStateModule('AZ', context({
        values: {
            charity: 1000,
            govtPension: 3000,
            az529: 2500,
            azLtcgPost2011: 10000
        }
    }));

    assert.equal(result.details.govtPensionExclusion, 2500);
    assert.equal(result.details.deduction529, 2000);
    assert.equal(result.details.ltcgSubtraction, 2500);
    assert.equal(result.details.charitableStandardIncrease, 1000);
    assert.equal(result.details.taxRate, 0.025);
});

test('Arizona applies HB 4168 federal-linked and advisor-entered adjustments', () => {
    const result = calculateStateModule('AZ', context({
        taxableSS: 1000,
        deductibleTips: 10000,
        deductibleOT: 5000,
        seniorBonus: 6000,
        values: {
            az530ADistributions: 2000,
            azDependentCareExpenseExcess: 1000,
            azQualifiedProductionPropertyDepreciation: 3000,
            autoLoanInterest: 10000
        }
    }));

    assert.equal(result.additions, 3000);
    assert.equal(result.subtractions, 25000);
    assert.equal(result.adjustedGrossIncome, 78000);
    assert.equal(result.details.qualifiedTipsSubtraction, 10000);
    assert.equal(result.details.qualifiedOvertimeSubtraction, 5000);
    assert.equal(result.details.seniorSubtraction, 6000);
    assert.equal(result.details.distribution530ASubtraction, 2000);
    assert.equal(result.details.dependentCareSubtraction, 1000);
    assert.equal(result.details.qualifiedProductionPropertyAddback, 3000);
    assert.equal(Object.prototype.hasOwnProperty.call(result.details, 'autoInterestSubtraction'), false);
});

test('Arizona caps the standard charity increase and itemized SALT deduction', () => {
    const singleStandard = calculateStateModule('AZ', context({ values: { charity: 5000 } }));
    const jointStandard = calculateStateModule('AZ', context({
        filingStatus: 'MFJ',
        isMFJ: true,
        federalStandardDeduction: 32200,
        values: { charity: 5000 }
    }));
    const itemized = calculateStateModule('AZ', context({
        values: { salt: 20000, mortgageInterest: 20000 }
    }));

    assert.equal(singleStandard.details.charitableStandardIncrease, 1000);
    assert.equal(singleStandard.deduction, 17100);
    assert.equal(jointStandard.details.charitableStandardIncrease, 2000);
    assert.equal(jointStandard.deduction, 34200);
    assert.equal(itemized.details.itemizedSaltDeduction, 10000);
    assert.equal(itemized.deduction, 30000);
});

test('Arizona uses the $125 under-17 dependent credit and five-percent phaseout steps', () => {
    const belowThreshold = calculateStateModule('AZ', context({
        values: { childDependents: 1, otherDependents: 1 }
    }));
    const firstPhaseoutStep = calculateStateModule('AZ', context({
        federalAGI: 200001,
        values: { childDependents: 1, otherDependents: 1 }
    }));

    assert.equal(belowThreshold.credits, 150);
    assert.equal(firstPhaseoutStep.credits, 142.5);
});

test('California adapter exposes progressive and surtax details', () => {
    const result = calculateStateModule('CA', context({
        federalAGI: 1100000,
        values: { hsaContrib: 5000 }
    }));

    assert.equal(result.additions, 5000);
    assert.ok(result.details.baseTax > 0);
    assert.ok(result.details.mentalHealthTax > 0);
});

test('Colorado starts with federal taxable income and applies entered planning adjustments', () => {
    const result = calculateStateModule('CO', context({
        federalTaxableIncome: 100000,
        values: {
            usGovInterest: 2000,
            coRetirementSubtraction: 20000,
            co529Deduction: 5000,
            coStateIncomeTaxAddback: 3000
        }
    }));

    assert.equal(result.additions, 3000);
    assert.equal(result.subtractions, 27000);
    assert.equal(result.taxableIncome, 76000);
    assert.equal(result.tax, 3344);
    assert.equal(result.details.startingPointLabel, 'Federal taxable income');
});

test('Virginia applies resident subtractions, deductions, exemptions, and progressive rates', () => {
    const result = calculateStateModule('VA', context({
        federalAGI: 100000,
        taxableSS: 10000,
        ageCount: 1,
        values: {
            usGovInterest: 2000,
            vaMilitaryRetirement: 20000,
            vaAgeDeduction: 5000,
            va529Deduction: 4000,
            childDependents: 1
        }
    }));

    assert.equal(result.subtractions, 41000);
    assert.equal(result.adjustedGrossIncome, 59000);
    assert.equal(result.details.exemptions, 2660);
    assert.equal(result.deduction, 11410);
    assert.equal(result.taxableIncome, 47590);
    assert.equal(result.tax, 2478.925);
    assert.equal(result.details.itemizationReviewRequired, false);
});

test('Virginia flags a missing state itemized amount when the federal return itemizes', () => {
    const missingStateItemized = calculateStateModule('VA', context({ usedStandard: false }));
    const enteredStateItemized = calculateStateModule('VA', context({
        usedStandard: false,
        values: { vaItemizedDeduction: 20000 }
    }));

    assert.equal(missingStateItemized.details.itemizationReviewRequired, true);
    assert.equal(enteredStateItemized.details.itemizationReviewRequired, false);
    assert.equal(enteredStateItemized.details.enteredItemizedDeduction, 20000);
});

test('Ohio separates simple Schedule C business income and flags local-tax review', () => {
    const result = calculateStateModule('OH', context({
        federalAGI: 400000,
        scheduleC: { totalNetProfit: 300000 }
    }));

    assert.equal(result.details.businessIncome, 300000);
    assert.equal(result.details.businessIncomeDeduction, 250000);
    assert.equal(result.details.taxableBusinessIncome, 50000);
    assert.equal(result.details.taxableNonbusinessIncome, 98100);
    assert.equal(result.details.businessTax, 1500);
    assert.equal(result.tax, 4197.75);
    assert.equal(result.adjustedGrossIncome - result.deduction, result.taxableIncome);
    assert.equal(result.details.businessReviewRequired, true);
    assert.equal(result.details.localTaxReviewRequired, true);
});

test('Tennessee returns zero individual income tax and flags entity-level business review', () => {
    const result = calculateStateModule('TN', context({
        federalAGI: 250000,
        federalTaxableIncome: 220000,
        scheduleC: { totalNetProfit: 100000 }
    }));

    assert.equal(result.tax, 0);
    assert.equal(result.taxableIncome, 0);
    assert.equal(result.details.entityReviewRequired, true);
    assert.match(result.details.limitations, /does not impose an individual income tax/i);
});

test('South Carolina applies focused resident adjustments using published 2025 brackets', () => {
    const result = calculateStateModule('SC', context({
        federalTaxableIncome: 100000,
        taxableSS: 10000,
        scheduleC: { totalNetProfit: 20000 },
        values: {
            usGovInterest: 2000,
            ltcg: 20000,
            stcg: -5000,
            scStateIncomeTaxAddback: 3000,
            scRetirementIncomeDeduction: 10000,
            scAge65Deduction: 5000,
            scMilitaryRetirementDeduction: 4000,
            sc529Deduction: 3000
        }
    }));

    assert.equal(result.additions, 3000);
    assert.equal(result.details.qualifyingNetCapitalGain, 15000);
    assert.equal(result.details.capitalGainDeduction, 6600);
    assert.equal(result.subtractions, 40600);
    assert.equal(result.taxableIncome, 62400);
    assert.ok(Math.abs(result.tax - 3102.3) < 0.001);
    assert.equal(result.details.conformityReviewRequired, true);
    assert.equal(result.details.businessReviewRequired, true);
});
