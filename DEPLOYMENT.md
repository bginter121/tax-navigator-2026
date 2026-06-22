# Deployment and State Source Monitoring

## Release Flow

1. Open or update a pull request into `main`.
2. Require the Calculator Tests workflow to pass.
3. Review calculator behavior and all state confidence labels.
4. Merge the approved commit into `main`.
5. The Deploy GitHub Pages workflow reruns all tests and deploys only `index.html`, `tax-engine.js`, and `state-modules.js`.
6. Verify the public URL and the workflow deployment summary.

GitHub Pages must use GitHub Actions as its deployment source. The `github-pages` environment can be protected with required reviewers if the repository settings support that policy.

## Rollback

The pre-deployment calculator is preserved by tag:

```text
state-tn-sc-sprint-8
```

If a deployment regression occurs, create a new rollback commit from that tag rather than deleting history or moving the tag.

## State Source Watch

The State Source Watch workflow runs every Monday and can also be started manually. It:

- Reads `data/state-sources.json`.
- Downloads only the registered official sources.
- Records availability, response metadata, and SHA-256 fingerprints.
- Uploads JSON and Markdown reports as workflow artifacts.
- Opens one `State source review needed` issue when a source changed, is unreachable, lacks an approved baseline, or passed its review date.

The watcher never edits calculator rules and never deploys a tax update.

## Approving Initial Baselines

Every source begins with `expectedSha256: null`. The first watcher run will therefore request baseline review. For each source:

1. Open the official page or PDF and verify that it is the document used by the module.
2. Run the watcher with baseline writing enabled:

```text
npm run sources:check -- --write-baseline
```

3. Review the resulting registry diff and the generated report.
4. Commit the fingerprints through the normal review and test process.

Do not accept a baseline merely because a URL returned successfully. A successful response can still be an access-denied page, an obsolete form, or unrelated content.

## Reviewing an Alert

When a fingerprint changes:

1. Compare the new official document with the prior reviewed source.
2. Decide whether the change affects a modeled rule, a limitation, or only page formatting.
3. Update the state calculation and published-example fixtures when required.
4. Update `lastReviewedAt`, `reviewBy`, and the accepted fingerprint only after review.
5. Merge only after the full calculator suite passes.
