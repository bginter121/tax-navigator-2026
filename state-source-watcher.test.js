'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { STATE_MODULE_METADATA } = require('./state-modules.js');

async function watcher() {
    return import('./scripts/check-state-sources.mjs');
}

test('state source registry covers every official module source', () => {
    const registry = JSON.parse(fs.readFileSync('data/state-sources.json', 'utf8'));
    const registryByCode = new Map(registry.states.map(state => [state.code, state]));

    for (const code of ['AZ', 'CA', 'CO', 'VA', 'OH', 'TN', 'SC']) {
        const registered = registryByCode.get(code);
        assert.ok(registered, `Missing ${code} source registry`);
        for (const url of STATE_MODULE_METADATA[code].sources) {
            assert.ok(
                registered.sources.some(source => source.url === url),
                `Missing ${code} module source ${url}`
            );
        }
    }
});

test('source classification distinguishes current, changed, missing baseline, and unreachable', async () => {
    const { classifyObservation } = await watcher();
    const source = { expectedSha256: 'expected' };

    assert.equal(classifyObservation(source, { ok: true, sha256: 'expected' }), 'current');
    assert.equal(classifyObservation(source, { ok: true, sha256: 'different' }), 'changed');
    assert.equal(classifyObservation({ expectedSha256: null }, { ok: true, sha256: 'new' }), 'baseline-required');
    assert.equal(classifyObservation(source, { ok: false }), 'unreachable');
});

test('content monitoring checks stable rule markers without hashing volatile pages', async () => {
    const { classifyObservation } = await watcher();
    const source = { monitorMode: 'content', expectedText: ['$8,750', '$17,500'] };

    assert.equal(classifyObservation(source, { ok: true, text: '<p>$8,750 and $17,500</p>' }), 'current');
    assert.equal(classifyObservation(source, { ok: true, text: '<p>$9,200 and $18,400</p>' }), 'content-mismatch');
});

test('optional source failures remain visible without creating a review alert', async () => {
    const { buildReport } = await watcher();
    const registry = {
        taxYear: 2026,
        policy: { humanApprovalRequired: true },
        states: [{
            code: 'TS',
            name: 'Test State',
            moduleStatus: 'projected',
            lastReviewedAt: '2026-01-01',
            reviewBy: '2026-12-31',
            sources: [{
                id: 'optional-source',
                label: 'Optional Source',
                url: 'https://example.test/tax',
                required: false,
                monitorMode: 'availability'
            }]
        }]
    };
    const report = await buildReport(registry, {
        now: '2026-06-22T12:00:00.000Z',
        fetcher: async () => ({ ok: false, httpStatus: 403, error: 'HTTP 403' })
    });

    assert.equal(report.needsReview, false);
    assert.equal(report.summary.unreachable, 1);
    assert.equal(report.summary.requiredAlerts, 0);
});

test('known production mismatches force review even when official sources are current', async () => {
    const { buildReport } = await watcher();
    const registry = {
        taxYear: 2026,
        policy: { humanApprovalRequired: true },
        states: [{
            code: 'TS',
            name: 'Test State',
            moduleStatus: 'projected',
            lastReviewedAt: '2026-01-01',
            reviewBy: '2026-12-31',
            forceReviewReason: 'The calculator does not match the enacted formula.',
            sources: [{
                id: 'official-source',
                label: 'Official Source',
                url: 'https://example.test/tax',
                monitorMode: 'content',
                expectedText: ['enacted formula']
            }]
        }]
    };
    const report = await buildReport(registry, {
        now: '2026-06-22T12:00:00.000Z',
        fetcher: async () => ({
            ok: true,
            httpStatus: 200,
            text: 'enacted formula',
            observedAt: '2026-06-22T12:00:00.000Z'
        })
    });

    assert.equal(report.needsReview, true);
    assert.equal(report.summary.requiredAlerts, 0);
    assert.equal(report.summary.forcedReviews, 1);
    assert.equal(report.states[0].status, 'manual-review-required');
});

test('source fetcher fingerprints successful content without interpreting it', async () => {
    const { fetchSource } = await watcher();
    const body = 'published tax table';
    const observation = await fetchSource({
        url: `data:text/plain,${encodeURIComponent(body)}`,
        kind: 'html'
    });

    assert.equal(observation.ok, true);
    assert.equal(observation.sha256, crypto.createHash('sha256').update(body).digest('hex'));
});

test('watch report requires review without silently changing tax data', async () => {
    const { buildReport } = await watcher();
    const registry = {
        taxYear: 2026,
        policy: { humanApprovalRequired: true },
        states: [{
            code: 'TS',
            name: 'Test State',
            moduleStatus: 'projected',
            lastReviewedAt: '2026-01-01',
            reviewBy: '2026-12-31',
            sources: [{
                id: 'test-source',
                label: 'Test Source',
                url: 'https://example.test/tax',
                expectedSha256: 'old'
            }]
        }]
    };
    const report = await buildReport(registry, {
        now: '2026-06-22T12:00:00.000Z',
        fetcher: async () => ({
            ok: true,
            httpStatus: 200,
            sha256: 'new',
            observedAt: '2026-06-22T12:00:00.000Z'
        })
    });

    assert.equal(report.needsReview, true);
    assert.equal(report.summary.changed, 1);
    assert.equal(report.states[0].status, 'changed');
    assert.equal(registry.states[0].sources[0].expectedSha256, 'old');
});
