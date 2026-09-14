# Governance

RentnerProxy is a maintainer-led project. [RentnerKev](https://github.com/RentnerKev) is the
current project lead and maintainer and makes final project decisions.

## Roles and responsibilities

- The maintainer sets priorities, reviews contributions, accepts or rejects changes, maintains
  repository automation, coordinates security reports and releases, and moderates project spaces.
  The maintainer must keep project policies and the public roadmap consistent with decisions.
- Contributors propose focused changes, provide tests and documentation where appropriate,
  follow [CONTRIBUTING.md](CONTRIBUTING.md), and address review feedback.
- Users and testers report reproducible problems and feedback through
  [issues](https://github.com/RentnerKev/RentnerProxy/issues). Sensitive vulnerability reports
  must use [SECURITY.md](SECURITY.md).

## Decisions and disagreements

Normal changes are proposed through pull requests and decided by the maintainer after reviewing
scope, correctness, tests, compatibility, and maintenance cost. The existing administrator direct
commit exception is documented in CONTRIBUTING.md; it does not remove the obligation to validate
changes. Dependency automation and reviewers inform decisions but do not set project policy.

Discuss larger features and architectural changes in an issue before implementation. Describe the
problem, alternatives, compatibility and security consequences, and how the change fits the
[roadmap](ROADMAP.md) and [architecture](ARCHITECTURE.md). Record the resulting decision and its
reason in the issue or pull request. There is no formal voting body or quorum.

Resolve technical disagreements in the relevant issue or pull request using concrete evidence and
respectful discussion. The maintainer makes the final decision and explains the reason. New
information may justify reconsideration. Conduct disputes follow the
[Code of Conduct](CODE_OF_CONDUCT.md); the project has no independent appeals committee.

## Becoming a maintainer and continuity

A contributor may express interest in maintenance after sustained, reliable contributions and
constructive review. The current maintainer decides whether to invite them, agrees their scope and
responsibilities, and updates this document when they actually accept the role. Contribution count
alone does not grant repository access.

The project currently documents one maintainer. No second maintainer, shared recovery arrangement,
or ability to resume administration within one week of losing that maintainer is established by
this policy. Access continuity and a bus factor of two remain unresolved.

## Policy maintenance

Policy changes use the same contribution and decision process. The maintainer reviews the roadmap
as priorities change and at least annually. Recognized project achievements, including the OpenSSF
Best Practices badge, must be linked from the repository front page within 48 hours of public
recognition. The badge link in [README.md](README.md) shows the current awarded level; it is not a
claim that Silver has been achieved. Release responsibilities are detailed in
[RELEASING.md](RELEASING.md).
