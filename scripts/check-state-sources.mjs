#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REGISTRY = 'data/state-sources.json';
const DEFAULT_REPORT = 'reports/state-source-status.json';
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 30000;

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function isoDate(value) {
    return new Date(value).toISOString().slice(0, 10);
}

async function readResponseBytes(response, maxBytes = MAX_SOURCE_BYTES) {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
            await reader.cancel();
            throw new Error(`Source exceeds ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks, totalBytes);
}

export async function fetchSource(source, options = {}) {
    const timeoutMs = options.timeoutMs || SOURCE_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(source.watchUrl || source.url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                Accept: source.kind === 'pdf' ? 'application/pdf,*/*;q=0.8' : 'text/html,*/*;q=0.8',
                'User-Agent': 'Tax-Navigator-State-Source-Watcher/1.0 (+https://github.com/bginter121/tax-navigator-2026)'
            }
        });
        const bytes = await readResponseBytes(response, options.maxBytes);
        if (!response.ok) {
            return {
                ok: false,
                httpStatus: response.status,
                error: `HTTP ${response.status}`,
                observedAt: new Date().toISOString()
            };
        }

        return {
            ok: true,
            httpStatus: response.status,
            finalUrl: response.url,
            contentType: response.headers.get('content-type'),
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
            bytes: bytes.byteLength,
            sha256: sha256(bytes),
            text: bytes.toString('utf8'),
            observedAt: new Date().toISOString()
        };
    } catch (error) {
        return {
            ok: false,
            httpStatus: null,
            error: error.name === 'AbortError' ? `Timed out after ${timeoutMs} ms` : error.message,
            observedAt: new Date().toISOString()
        };
    } finally {
        clearTimeout(timer);
    }
}

function normalizedText(value) {
    return String(value || '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;|&#34;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function classifyObservation(source, observation) {
    if (!observation.ok) return 'unreachable';
    const monitorMode = source.monitorMode || 'fingerprint';
    if (monitorMode === 'availability') return 'current';
    if (monitorMode === 'content') {
        if (!Array.isArray(source.expectedText) || source.expectedText.length === 0) {
            return 'configuration-error';
        }
        const observedText = normalizedText(observation.text);
        return source.expectedText.every(expected => observedText.includes(normalizedText(expected)))
            ? 'current'
            : 'content-mismatch';
    }
    if (monitorMode !== 'fingerprint') return 'configuration-error';
    if (!source.expectedSha256) return 'baseline-required';
    return source.expectedSha256 === observation.sha256 ? 'current' : 'changed';
}

function stateStatus(sourceResults, reviewOverdue, forceReviewReason) {
    const requiredSources = sourceResults.filter(source => source.required);
    if (requiredSources.some(source => source.status === 'unreachable')) return 'unreachable';
    if (requiredSources.some(source => source.status === 'content-mismatch')) return 'content-mismatch';
    if (requiredSources.some(source => source.status === 'changed')) return 'changed';
    if (requiredSources.some(source => source.status === 'configuration-error')) return 'configuration-error';
    if (requiredSources.some(source => source.status === 'baseline-required')) return 'baseline-required';
    if (forceReviewReason) return 'manual-review-required';
    if (reviewOverdue) return 'review-overdue';
    return 'current';
}

export async function buildReport(registry, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const fetcher = options.fetcher || fetchSource;
    const today = isoDate(now);
    const states = [];

    for (const state of registry.states) {
        const sources = [];
        for (const source of state.sources) {
            const observation = await fetcher(source);
            sources.push({
                id: source.id,
                label: source.label,
                url: source.url,
                watchUrl: source.watchUrl || source.url,
                required: source.required !== false,
                monitorMode: source.monitorMode || 'fingerprint',
                status: classifyObservation(source, observation),
                expectedSha256: source.expectedSha256,
                observedSha256: observation.sha256 || null,
                httpStatus: observation.httpStatus,
                contentType: observation.contentType || null,
                etag: observation.etag || null,
                lastModified: observation.lastModified || null,
                bytes: observation.bytes || null,
                missingExpectedText: (source.expectedText || []).filter(expected =>
                    !normalizedText(observation.text).includes(normalizedText(expected))
                ),
                error: observation.error || null,
                observedAt: observation.observedAt || now.toISOString()
            });
        }

        const reviewOverdue = Boolean(state.reviewBy && state.reviewBy <= today);
        const status = stateStatus(sources, reviewOverdue, state.forceReviewReason);
        states.push({
            code: state.code,
            name: state.name,
            moduleStatus: state.moduleStatus,
            lastReviewedAt: state.lastReviewedAt,
            reviewBy: state.reviewBy,
            reviewOverdue,
            forceReviewReason: state.forceReviewReason || null,
            status,
            sources
        });
    }

    const allSources = states.flatMap(state => state.sources);
    const requiredSources = allSources.filter(source => source.required);
    const alertStatuses = new Set([
        'changed', 'unreachable', 'baseline-required', 'content-mismatch', 'configuration-error'
    ]);
    const summary = {
        states: states.length,
        sources: allSources.length,
        requiredSources: requiredSources.length,
        requiredAlerts: requiredSources.filter(source => alertStatuses.has(source.status)).length,
        current: allSources.filter(source => source.status === 'current').length,
        changed: allSources.filter(source => source.status === 'changed').length,
        unreachable: allSources.filter(source => source.status === 'unreachable').length,
        baselineRequired: allSources.filter(source => source.status === 'baseline-required').length,
        contentMismatch: allSources.filter(source => source.status === 'content-mismatch').length,
        configurationErrors: allSources.filter(source => source.status === 'configuration-error').length,
        forcedReviews: states.filter(state => state.forceReviewReason).length,
        reviewsOverdue: states.filter(state => state.reviewOverdue).length
    };

    return {
        schemaVersion: 1,
        taxYear: registry.taxYear,
        checkedAt: now.toISOString(),
        humanApprovalRequired: registry.policy.humanApprovalRequired,
        needsReview: summary.requiredAlerts > 0 || summary.reviewsOverdue > 0 || summary.forcedReviews > 0,
        summary,
        states
    };
}

export function markdownReport(report) {
    const lines = [
        `# State Source Watch - ${report.checkedAt.slice(0, 10)}`,
        '',
        `Tax year: ${report.taxYear}`,
        '',
        '| State | Module status | Watch status | Review by |',
        '| --- | --- | --- | --- |'
    ];
    report.states.forEach(state => {
        lines.push(`| ${state.code} | ${state.moduleStatus} | ${state.status} | ${state.reviewBy || '-'} |`);
    });
    lines.push('', `Changed: ${report.summary.changed}`);
    lines.push(`Unreachable: ${report.summary.unreachable}`);
    lines.push(`Baseline required: ${report.summary.baselineRequired}`);
    lines.push(`Content mismatch: ${report.summary.contentMismatch}`);
    lines.push(`Configuration errors: ${report.summary.configurationErrors}`);
    lines.push(`Required source alerts: ${report.summary.requiredAlerts}`);
    lines.push(`Forced reviews: ${report.summary.forcedReviews}`);
    lines.push(`Reviews overdue: ${report.summary.reviewsOverdue}`);
    const forcedReviews = report.states.filter(state => state.forceReviewReason);
    if (forcedReviews.length) {
        lines.push('', '## Known production review items', '');
        forcedReviews.forEach(state => lines.push(`- **${state.code}:** ${state.forceReviewReason}`));
    }
    lines.push('', 'A source alert never changes calculator rules automatically. Review the official document, update fixtures, and approve the resulting code change before deployment.');
    return `${lines.join('\n')}\n`;
}

function parseArguments(argv) {
    const options = {
        registryPath: DEFAULT_REGISTRY,
        reportPath: DEFAULT_REPORT,
        writeBaseline: false,
        strict: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--registry') options.registryPath = argv[++index];
        else if (argument === '--report') options.reportPath = argv[++index];
        else if (argument === '--write-baseline') options.writeBaseline = true;
        else if (argument === '--strict') options.strict = true;
        else throw new Error(`Unknown argument: ${argument}`);
    }
    return options;
}

async function writeAcceptedBaselines(registry, report, registryPath) {
    const reportStates = new Map(report.states.map(state => [state.code, state]));
    const acceptedAt = report.checkedAt.slice(0, 10);
    let acceptedSources = 0;

    registry.states.forEach(state => {
        const reportState = reportStates.get(state.code);
        let stateComplete = true;
        state.sources.forEach(source => {
            const observed = reportState.sources.find(candidate => candidate.id === source.id);
            if (!observed || !observed.observedSha256) {
                stateComplete = false;
                return;
            }
            source.expectedSha256 = observed.observedSha256;
            acceptedSources += 1;
        });
        if (stateComplete) state.lastReviewedAt = acceptedAt;
    });

    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    return acceptedSources;
}

async function main() {
    const options = parseArguments(process.argv.slice(2));
    const registryPath = path.resolve(options.registryPath);
    const reportPath = path.resolve(options.reportPath);
    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    const report = await buildReport(registry);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const markdownPath = reportPath.replace(/\.json$/i, '.md');
    const markdown = markdownReport(report);
    await writeFile(markdownPath, markdown);

    if (process.env.GITHUB_STEP_SUMMARY) {
        await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
    }
    if (process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, `needs_review=${report.needsReview}\n`);
        await appendFile(process.env.GITHUB_OUTPUT, `report_path=${path.relative(process.cwd(), reportPath)}\n`);
    }

    if (options.writeBaseline) {
        const acceptedSources = await writeAcceptedBaselines(registry, report, registryPath);
        console.log(`Accepted ${acceptedSources} observed source fingerprints. Review and commit the registry changes.`);
    }

    console.log(markdown);
    if (options.strict && report.needsReview) process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
