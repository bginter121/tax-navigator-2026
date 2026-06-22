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
        federalStandardDeduction: 16100,
        ...overrides
    };
}

test('every enabled state publishes planning metadata and official sources', () => {
    for (const code of ['AZ', 'CA']) {
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
});

test('all state adapters return the shared result contract', () => {
    const requiredKeys = [
        'code', 'name', 'taxYear', 'status', 'statusLabel', 'sources',
        'tax', 'adjustedGrossIncome', 'taxableIncome', 'deduction',
        'credits', 'additions', 'subtractions', 'details'
    ];

    for (const code of ['none', 'AZ', 'CA']) {
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
