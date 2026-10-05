# GitHub automation

Workflows under `workflows/` own triggers, permissions, job dependencies, trusted
checkouts and artifacts. Short process commands stay in YAML; validation and
publication logic live in the corresponding scripts.

The script areas are:

- `scripts/ci/`: PR metadata, bounded runtime selection and isolated smoke fixtures.
- `scripts/security/`: verified Gitleaks installation and redacted commit scans.
- `scripts/release/`: release identity, preparation, image checks and notes publication.
- `scripts/deploy/`: development images and the separate preview build/publish handoff.
- `scripts/lib/`: shared release-note rendering. Types stay with their owning area.

Run workflow scripts from the repository workspace. Release and preview jobs load
automation from their exact trusted workflow revision and keep build source in a
separate checkout. PR title and scanner tooling use the trusted PR base revision;
push jobs use the pushed commit. Checkout credentials are not persisted.

Product development, build and recovery tools stay under the root `scripts/`
directory. The root `package.json` and `tsconfig.scripts.json` remain the entry
points for tooling. Automation tests live under `web/src/tests/tooling/`; they
exercise validation with isolated fixtures and mocked external tools. Normal PR
and push reliability checks select the short profile. Long profiles are selected
only by schedules or explicit dispatch.
