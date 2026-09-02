# Release process

RentnerProxy has no stable public release yet. The current main branch and its immutable commit
identifiers represent development snapshots.

## Versioning

User-facing releases use Semantic Versioning with a pre-release suffix while the project is
unstable, for example v0.1.0-alpha.1. Every release receives a unique version and an annotated
Git tag in Git. Development snapshots remain identifiable by their full commit SHA.

## Release checklist

1. Confirm that the intended commit is on main and all required CI, CodeQL, Gitleaks, dependency,
   workflow-lint, and Scorecard checks are successful.
2. Run bun run check and review the security findings and dependency changes.
3. Update CHANGELOG.md with a human-readable summary under the new version, including any known
   project runtime vulnerability identifiers and upgrade impact.
4. Create and push an annotated tag such as v0.1.0-alpha.1.
5. Create a GitHub Release for that tag and copy the relevant changelog summary into the release
   notes.
6. Build or publish the corresponding immutable container image tag, test the upgrade, and retain
   rollback and backup evidence.
7. Announce incompatible changes and document any required migration or configuration steps.

Do not publish a release containing unresolved medium-or-higher project vulnerabilities. Dependency
vulnerabilities are tracked by the dependency audit and review workflows and must be updated or
explicitly assessed before release.
