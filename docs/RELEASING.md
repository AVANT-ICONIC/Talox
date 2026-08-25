# Releasing Talox

Talox GitHub releases are created through the guarded manual `Release` workflow in GitHub Actions. The workflow is intentionally not triggered by pushes or tags.

## Dry run

1. Open **Actions → Release → Run workflow**.
2. Select the `main` branch.
3. Enter the intended tag, for example `v9.0.0`.
4. Leave **dry_run** enabled.
5. Run the workflow.

A dry run creates no tag and no GitHub Release. It verifies the release contract, typechecks and builds the package, runs the full unit suite, audits production dependencies, packs the actual npm tarball, installs that tarball into a fresh temporary consumer project, imports every public package surface (`talox`, `talox/plugins`, `talox/adapters`, and `talox/local-vision`), runs the installed `talox --help` binary, and then runs the Chromium browser integration suite.

The same packed-package consumer smoke also runs in normal CI so export-map, tarball, dependency, and CLI packaging regressions are caught before release day.

## Publish

Only publish after a dry run passes on the same `main` commit.

1. Run the `Release` workflow again from `main` with the same tag.
2. Disable **dry_run**.
3. Enter the confirmation exactly as `RELEASE <tag>`, for example `RELEASE v9.0.0`.

The workflow refuses to replace an existing tag or GitHub Release. The requested tag must match `package.json`, and `CHANGELOG.md` must contain a non-empty section for that version.

## Permission boundary

Validation runs with read-only repository contents permission. The separate publish job receives `contents: write` only after the validation job succeeds and only when `dry_run` is disabled. Talox does not publish to npm from this workflow.
