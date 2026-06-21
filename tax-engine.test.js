'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateTaxLiability,
    getSaltCap,
    compareScenarios,
    analyzeRothConversion
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
