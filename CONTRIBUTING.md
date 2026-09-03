# Contributing to RentnerProxy

Thank you for contributing to RentnerProxy. The project is at an early stage, so focused changes and clear discussion are especially valuable.

## Before you start

Search the existing issues before opening a new one. Please open an issue before starting a large feature. Large architectural changes should be discussed in an issue before implementation.

Never include credentials, tokens, private configuration, personal data, or unredacted sensitive logs in an issue, commit, or pull request.

## Development workflow

1. Search the existing issues. Open the appropriate issue form for a meaningful bug or feature
   before starting work; report vulnerabilities only through the [security policy](SECURITY.md).
2. Fork the repository and create a focused feature branch from `main`.
3. Install Bun 1.4 and Rust 1.97.1 to match CI (the controller requires Rust 1.88 or newer), then
   install dependencies with `bun install --frozen-lockfile`.
4. Make a small, self-contained change and add or update tests where appropriate.
5. Run `bun run check` before opening a pull request.
6. Push the branch and open a pull request. Link meaningful feature and fix changes with
   `Fixes #123` or `Closes #123`; documentation, CI, and tiny maintenance changes may explain why
   no issue is needed.
7. Let the required CI and security checks finish, then address maintainer review feedback.

After the required checks succeed, automation may publish a PR preview Docker image. It contains
unreviewed contributor code: back up any test instance, use isolated test data, and never run it
with production data.

Database schema changes require a generated Drizzle migration. Review and commit generated
migration SQL and run `bun run db:check` before opening the pull request.

## Commit convention

Use Conventional Commits in English:

```text
type(scope): description
```

Examples:

```text
feat(web): add settings form
fix(controller): handle shutdown error
test(web): add health parser coverage
docs(readme): update setup instructions
chore(deps): update dependencies
```

Keep commits small and understandable. Do not mix unrelated changes in one commit. Pull request titles must follow the same convention; the scope is optional.

## Testing policy

Every major feature, security-sensitive change, or externally visible behavior change must add
or update automated tests. Tests should cover successful behavior, invalid input, authorization,
and relevant failure paths. Changes that affect parsers, token handling, configuration, or other
input-heavy code should also extend the fuzz or property-based test suite where practical.

Run the complete check before opening a pull request:

```bash
bun run check
```

If a change cannot reasonably include a test, explain the reason in the pull request and identify
the manual or integration verification that replaces it.

## Pull requests

Keep pull requests focused and complete the pull request template. Confirm that tests and documentation cover the change, that `bun run check` passes, and that no secrets or sensitive data are included. Address review feedback with follow-up commits so reviewers can verify the final result.
