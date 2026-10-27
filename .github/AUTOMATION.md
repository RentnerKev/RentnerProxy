# GitHub automation

Workflows under `workflows/` own triggers, permissions, job dependencies, trusted
checkouts and artifacts. Short commands stay in YAML; validation and publication
logic live in the corresponding scripts. See [the overview](WORKFLOWS.md) for
workflow purpose, triggers, required checks and dependency assessment scope.

The script areas are:

- `scripts/ci/`: preview source evidence, bounded runtime selection, isolated
  smoke fixtures and the published-source release compatibility matrix.
- `scripts/security/`: complete own Cargo/Bun audits, current Dev-image rescans,
  exact image approval, checksum-verified cargo-audit/Gitleaks installation and
  redacted commit scans.
- `scripts/release/`: release identity, preparation, image checks and notes publication.
- `scripts/deploy/`: development images and the separate preview build/publish handoff.
- `scripts/lib/`: shared release-note rendering. Types stay with their owning area.

Run scripts from the repository workspace. Release and preview jobs load
automation from the exact trusted workflow revision and keep build source in a
separate checkout. Preview-source capture and privileged scanner/publisher
automation use trusted revisions; push jobs use the pushed commit. Checkout
credentials are not persisted. Preview publication verifies the tested PR merge,
effective required checks and image assessment before registry writes.

Dependency Security also separates `automation/` from `source/`. PR audits use
automation from the immutable base SHA and inspect the exact tested merge SHA as
data. Push/manual audits use the workflow revision. Scanner commands run outside
the source checkout, preventing PR Cargo/Bun configuration from governing the
trusted audit. Changes to audit scripts and policy are exercised by automation
tests; they become authoritative gates after review and merge. The official
cargo-audit binary retains version 0.22.2 and is checksum-verified before
extraction; repeated audits in one job reuse only that job's installation.

Product development, build and recovery tools live under root `scripts/`, with
shared smoke infrastructure in `scripts/smoke/` and immutable release identities
in `scripts/compatibility/`. The [script guide](../scripts/README.md) describes
their entrypoints. Root `package.json` and `tsconfig.scripts.json` own tooling.

Automation tests under `web/src/tests/tooling/` use isolated fixtures and mocked
external tools. Production Smokes prepares three images once, bound to the run
and commit, then always cleans up that run's resources. Standalone commands
retain independent builds.

Normal reliability checks select the short profile against the current build.
Long profiles and scale tests require explicit manual selection. Release
Compatibility verifies fresh installation and immutable oldest/previous published
sources selected by the supported upgrade policy. Its Main-push gate remains
unfiltered for exact-revision release readiness. PR compatibility and reliability
filters include the full production build and shared automation inputs.
Optional metadata automation, Scorecard and separate upstream
advisory scanners are removed; own dependency and integration gates remain.
