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
        assert.equal(metadata.status, 'projected');
        assert.match(metadata.statusLabel, /projected planning estimate/i);
        assert.ok(metadata.sources.length > 0);
        metadata.sources.forEach(source => assert.match(source, /^https:\/\//));
    }
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
    assert.equal(result.details.taxRate, 0.025);
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
