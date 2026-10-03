# Local Docker release validation — 2026-10-03

The local validation is **not fully green**. With explicitly LF-preserving packaging, fresh
installation, direct upgrades from all six published Alpha images, historical backup restores
and exact-source rollbacks passed. Both release-duration reliability runs also passed.
Locally CRLF-packaged images reject historical backups, startup/shutdown measurements exposed
deployment problems, and the local Windows scale workload remains failed. Existing Linux CI on
the same source commit is separately green.

This report records local evidence for [Beta release gate #75](https://github.com/RentnerKev/RentnerProxy/issues/75).
It does not approve or publish a release.

## Tested source and environment

| Item                                                 | Value                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Merged `main` source                                 | `b572535253f96c7b1027b563c780c80b91282a31`                                |
| Equivalent local commit used by test metadata        | `d950f0d9416c7b0361517cea913d76be90a22efc`                                |
| Identical Git tree for both commits                  | `b01ccfa5a5cdc98f80b148b8cd7906285d6a7bcb`                                |
| Production test image                                | `sha256:b7f8e5b59aa2cbe6c8e6a0b70d1102bfebf1e2e68e810de72720dcd7e5173da3` |
| Startup/shutdown test image, same application source | `sha256:c9dd8af5142d1258b28d7c45342587902099f967addefe67bcc58d8cd96c78b7` |
| Host                                                 | Windows; Docker Desktop 4.93.0                                            |
| Docker runtime                                       | Engine 29.8.1, Compose 5.5.1, Linux/amd64                                 |
| Test tools                                           | Bun 1.4.2; Rust 1.98.1 for the Linux Caddy test build                     |
| Separate integration services                        | PostgreSQL 18.6; Valkey 9.1.2                                             |

Host-side suites ran from a disposable `git archive` of merged main without a local environment
file, using the installed dependencies. Git's local `core.autocrlf=true` configuration converted
archive text to CRLF even though TAR output and extraction used binary files. The original archive
therefore was not equivalent to Linux packaging. A second archive explicitly used per-command
`-c core.autocrlf=false -c core.eol=lf`; no global Git setting was changed. Its production image is
`sha256:431d4d12076cd7db3444bb8226b8e4589dd4df4db166014e265921fde0366f3a`.

The two commits above have identical source trees; the original runtime image label and harness
`targetSha` identify the local commit. Results identify both source and packaging conditions, and
do not certify a later fix or a future published Beta image.

The user expressly authorized existing migrations only in newly created, isolated Docker test
databases. No existing development database, credentials, environment file or user Valkey service
was modified. Fixture secrets and certificate keys are excluded from this report and GitHub issues.

## Automated suite results

The appliance failure in this table is the initial CRLF-package invocation. Its controlled LF
repeat completed successfully with 53 checks in 542 seconds, as detailed below.

| Suite                                  | Result | Evidence                                                                                                  |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| TypeScript unit tests                  | PASS   | 1,014 passed, 0 failed; 8 optional Valkey cases skipped in this invocation                                |
| Isolated PostgreSQL integration        | PASS   | 149 passed, including authentication, roles, per-user appearance and migration concurrency/failure checks |
| Isolated Valkey integration            | PASS   | All 8 previously skipped Valkey cases passed against the disposable service                               |
| Fuzz/property tests                    | PASS   | 24 passed                                                                                                 |
| Windows Rust tests                     | PASS   | 213 passed; one opt-in Caddy test ignored on Windows                                                      |
| Linux Rust tests with production Caddy | PASS   | 217 unit and 2 controller tests, followed by the opt-in real-Caddy test: 220 passed in total              |
| Production Docker build                | PASS   | Built the current production appliance locally                                                            |
| Proxy production smoke                 | PASS   | 51 checks; 92 seconds                                                                                     |
| Certificate/ACME production smoke      | PASS   | 51 checks; 221 seconds                                                                                    |
| Upstream TLS production smoke          | PASS   | 11 checks; 16 seconds                                                                                     |
| Production appliance smoke             | FAIL   | 46 checks completed before historical restore failed with `migration_history`; 428 seconds                |
| Runtime Scale, first attempt           | FAIL   | 100 hosts, concurrency 4, 3 rounds, seed 70; final route returned 502 after approximately 378 seconds     |
| Runtime Scale, unchanged repeat        | FAIL   | Same workload; host-side request failed in concurrent round 1 after approximately 38 seconds              |

The appliance smoke validated initial startup and its preceding assertions. Assertions after its
restore failure did not run and are not counted as passed. The successful Windows/Linux Caddy
tests are complementary: the Linux invocation executed the opt-in test skipped on Windows.

Format, type checking, lint and application builds were already validated during the preceding
dependency changes. This final session rebuilt the production Docker image and ran the suites
above; it does not claim a new successful remote CI run on a subsequent documentation commit.

## Existing Linux CI comparison

The reviewed GitHub runs identify the exact merged commit and the same tree above. Linux
[Production Smokes](https://github.com/RentnerKev/RentnerProxy/actions/runs/37149545898) passed all
55 appliance, 51 proxy, 51 certificate and 11 upstream-TLS checks. Its appliance coverage includes
Alpha 1/3 upgrade and post-upgrade backup/restore; it does not replace the Alpha 4–6 release-backup
matrix. These results are distinct from the initial local CRLF packages.

Linux [Runtime Scale](https://github.com/RentnerKev/RentnerProxy/actions/runs/37149545968) passed
100 hosts, concurrency 4, three rounds and seed 70 in 203.56 seconds. Its downloaded sanitized
report has `summary.passed=true`, eight final samples and `trendEvidence=comparable`, using image
`sha256:82dbf1c3eca1d5f84c520bad4aec8bc4b18a52259670c7257c3fa45c083d421f`.
The local Docker Desktop host-gateway failures do not invalidate that Linux result or prove an
application scaling regression. They remain an unresolved local test transport issue.

## Controlled LF-package compatibility

The complete standard compatibility suite was repeated from the LF-preserving archive, without
altering production validators or skipping test stages. All seven invocations exited zero:

| Source        | Direct upgrade/restart | Historical backup into fresh current volumes | Exact-source rollback into fresh volumes |
| ------------- | ---------------------- | -------------------------------------------- | ---------------------------------------- |
| Fresh current | PASS                   | Not applicable                               | Not applicable                           |
| Alpha 1       | PASS                   | Not part of this source case                 | Not part of this source case             |
| Alpha 2       | PASS                   | Not part of this source case                 | Not part of this source case             |
| Alpha 3       | PASS                   | Not part of this source case                 | Not part of this source case             |
| Alpha 4       | PASS                   | PASS                                         | PASS                                     |
| Alpha 5       | PASS                   | PASS                                         | PASS                                     |
| Alpha 6       | PASS                   | PASS                                         | PASS                                     |

The full production appliance repeat also passed: 53 assertions in 542 seconds. Its Windows-host
conditions exclude the POSIX backup-file mode assertion and Linux-only restore-interruption shim;
the reviewed Linux CI separately passed all 55 assertions, including those platform checks.
Alpha 6 retained its HTTP/3 and corrupt-journal failure checks. These successful repeats isolate
the packaging condition; the Windows/converted-archive failure remains a real portability issue.

## Initial CRLF-package compatibility

The following table records the initial local packages containing CRLF. Controlled LF-package
full-suite results are recorded separately below; the initial failed invocations are retained.

Each source image was pinned to its published digest and its expected revision was verified. Every
direct upgrade used isolated persistent volumes, then checked durable state, routed traffic and an
idempotent restart. Backup-capable historical versions used their own pinned release backup scripts.

| Published source           | Direct upgrade and restart | Backup restored into fresh current volumes                | Backup restored into fresh exact-source volumes |
| -------------------------- | -------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Alpha 1                    | PASS                       | Not part of this source case                              | Not part of this source case                    |
| Alpha 2                    | PASS                       | Not part of this source case                              | Not part of this source case                    |
| Alpha 3                    | PASS                       | Not part of this source case                              | Not part of this source case                    |
| Alpha 4                    | PASS                       | FAIL: `migration_history`                                 | PASS, independent rollback invocation           |
| Alpha 5                    | PASS                       | FAIL: `migration_history`                                 | PASS, independent rollback invocation           |
| Alpha 6                    | PASS                       | FAIL: `migration_history`                                 | PASS, independent rollback invocation           |
| Fresh current installation | PASS, including restart    | Current-to-current restore passed in reliability coverage | Not applicable                                  |

The standard Alpha 4–6 compatibility commands stop at the failed current restore, so their full
suite exit codes remain nonzero. To check rollback independently, only a disposable copy of the
test orchestration skipped that already-failed stage and explicitly reported it as failed. The
original exact-source rollback, login, encrypted-state, certificate, revision and traffic assertions
then ran against new source-image volumes. No production restore validator was changed. An old image
was never started against an upgraded database. Alpha 6 also verified HTTP/3.

The deliberately incomplete migration-journal case in Alpha 6 failed closed without exposing secrets.
This successful negative check does not resolve the separate historical fingerprint incompatibility.

| Source           | Pinned image digest                                                       |
| ---------------- | ------------------------------------------------------------------------- |
| `v1.0.0-alpha.1` | `sha256:f88edb70a80db7c527e1a963e835593f6998ab4541f810e26cf75ffa63da0d3f` |
| `v1.0.0-alpha.2` | `sha256:b96238a2d4e04cb40cc5b759113f8bc08bef25da3bb97fef9c0cd88748e9e582` |
| `v1.0.0-alpha.3` | `sha256:90d2a921daf7eeb116d18c4fbfabee7a2d937e05d031453affc1f3921e440483` |
| `v1.0.0-alpha.4` | `sha256:2ac30c6566fa76c2c9d798e9de782d9e7ae7179e07b296afa80fd928e2852929` |
| `v1.0.0-alpha.5` | `sha256:2a00a60a917df4bdabc34a6ec19022ef41f9b95df082312bb33ba28325f277f9` |
| `v1.0.0-alpha.6` | `sha256:bd20add05064c37275ec23f6dc0a2a84595734dcd047f7595d0321f232b95065` |

## Release-duration reliability

Both runs used `profile=long`, 1,800 requested seconds, an iteration ceiling of 1,000, concurrency 2,
seed 69 and resource capture. Both reached the requested duration and reported comparable resource
trend evidence without resource-limit violations.

| Source            | Completed cycles | Observed duration | Result | Disclosed limitation                        |
| ----------------- | ---------------: | ----------------: | ------ | ------------------------------------------- |
| Current tree      |               25 |  1,803.52 seconds | PASS   | Empty `knownLimitations`                    |
| Immutable Alpha 6 |               46 |  1,873.42 seconds | PASS   | `alpha6-binding-retry-needs-second-request` |

The Alpha 6 baseline required its documented, bounded second operator retry for the certificate
binding job. Its pass therefore includes that additional action. Current completed the binding
after one retry. The runs exercised real CrowdSec ban/removal and fail-open behavior, Forward Auth
failure behavior, importer retries, certificate/HTTP3 durability, current-version fresh-volume
backup/restore and recovery after Caddy, web, controller, database and admin-endpoint interruptions.

These bounded fixture results do not establish a production capacity limit or prove the absence of
longer-term leaks. They also do not turn the failed historical restore or scale suite green.

## Redeploy and in-flight traffic

External HTTP and HTTPS probes used real database-backed routes and an imported fixture certificate.
The outage measurement brackets the interval between successful probe starts, with 150 ms pauses
and 700 ms request limits. These are individual measurements on a shared local host.

| Same-source deployment scenario                    | HTTP outage bracket | HTTPS outage bracket |
| -------------------------------------------------- | ------------------: | -------------------: |
| Container restart                                  |       5.279 seconds |        5.271 seconds |
| Container force-recreate                           |       5.556 seconds |        5.542 seconds |
| PostgreSQL startup deliberately delayed 15 seconds |      20.385 seconds |       20.373 seconds |
| Valkey startup deliberately delayed 15 seconds     |      20.514 seconds |       20.504 seconds |

The entrypoint already starts the controller/Caddy before migrations and the web app, but waits for
PostgreSQL and Valkey first. Supported persisted snapshot recovery can serve existing proxy routes
without those waits. [#158](https://github.com/RentnerKev/RentnerProxy/issues/158) tracks the avoidable
dependency delay while preserving managed CrowdSec prerequisites and safe fresh-install behavior.

A real admitted sixteen-second HTTPS request was reset 10.185 seconds after shutdown began despite
an explicit thirty-second Compose stop budget. The appliance exited with code zero, without Docker
SIGKILL or OOM. The explicit ten-second stop also reset the request at 10.155 seconds and recorded a
Docker SIGKILL event near its deadline. The controller's ten-second Caddy shutdown/control deadlines
need alignment with the entrypoint, web and container budgets; see
[#159](https://github.com/RentnerKev/RentnerProxy/issues/159). This is evidence of interrupted traffic,
not database corruption or data loss. An unexplained three-second default-stop trace was excluded
from the causal conclusion.

## Local CRLF packaging and restore failure

[#160](https://github.com/RentnerKev/RentnerProxy/issues/160) records a local packaging incompatibility.
The unchanged current validator rejects published Alpha 4–6 backups in the tested CRLF packages
with `migration_history`. An independent Alpha 6 fixture confirmed newline-byte drift in both the
Windows working-tree build and locally converted archive. The initial claim that binary TAR output
proved canonical Linux bytes was corrected: Git itself applies working-tree conversion in archives.
A same-commit ordinary `package.json` control produced 103 CRLF lines with `core.autocrlf=true` and
none with `core.autocrlf=false`, without accessing source migration files.

| Comparison against Alpha 6's first 20 migrations | Published Alpha 6 | Current Git-archive image | Current Windows working-tree image |
| ------------------------------------------------ | ----------------: | ------------------------: | ---------------------------------: |
| Stored fingerprint matches packaged source       |             20/20 |            Not applicable |                     Not applicable |
| Raw target fingerprint matches                   |             20/20 |                      3/20 |                              12/20 |
| Diagnostic LF-normalized matches                 |             20/20 |                     20/20 |                              20/20 |
| Journal timestamp matches                        |             20/20 |                     20/20 |                              20/20 |

Both target packages rejected the restored historical fixture. A newly migrated current archive
database with all 27 entries passed the unchanged validator. LF normalization was diagnostic only;
neither migration sources nor restore guards were altered. Direct upgrade uses different migrator
checks, explaining why a successful upgrade does not establish backup restore compatibility.

The controlled LF archive packaged 27 migrations with zero CRLF entries. Its original Alpha 6
prefix hashes and timestamps matched 20/20. The unchanged packaged validator accepted the same
restored Alpha 6 v3 fixture and the fresh-current v4 positive control, both with exit zero.
This establishes the local CRLF packaging cause; a failing official Linux image is not demonstrated.

## Scale failure and diagnosis

The first full workload passed configuration growth, concurrent management, shipped integrations,
certificate checks, interruption recovery, appliance restart and deletion assertions before a final
502 on route 205. Desired/active revisions and persisted/runtime upstream inventory had matched.
Five complete final traffic sweeps passed, but final resource trend evidence remained `insufficient`.
The unchanged repeat failed earlier at a host-side fetch; its network error was not retained.

An independent experiment used the same packaged Caddy binary with 110 static HTTP routes, four
concurrent requests and a Windows Bun upstream through the Docker host gateway. With no database,
controller, importer, TLS or reconciliation, two runs produced five 502 responses among 2,750 proxy
GETs; all 25 sampled direct Windows upstream GETs returned 200. All four captured Caddy failures in
the second run were new TCP dial I/O timeouts of approximately three seconds.

This isolates a reproducible failure in the local Docker-to-Windows fixture transport. The original
full-stack 502's exact cause and the repeated host-fetch failure remain unknown; an application or
keepalive defect is not established. [#161](https://github.com/RentnerKev/RentnerProxy/issues/161) tracks
fixture connectivity and sanitized failure diagnostics. Local Windows scale validation remains
failed. The separate Linux CI result above passed the same bounded workload; future candidate
changes still require their own exact-ref release evidence.

## Evidence, cleanup and remaining gates

Local artifacts are retained under `temp/final-release-validation-20261003/` and are intentionally
untracked. They include the compatibility and rollback logs, `reliability-current.json`,
`reliability-alpha6.json`, `scale-first.json`, `scale-repeat.json`, production-smoke summaries,
Linux/Windows Rust logs, and the `downtime/`, `restore-investigation/` and `scale-investigation/`
diagnostic evidence. GitHub issues contain the sanitized reproduction details and acceptance checks.
Controlled repeats are recorded in `canonical-compat-*.log`, `canonical-install-matrix.json`,
`canonical-compat-matrix.json` and `canonical-production.log`. `ci-evidence/scale/report.json`
preserves the downloaded sanitized Linux CI scale comparison. Early invalid test-scope and public
origin setup attempts were corrected before execution and are not classified as product failures.

Owned test containers, labeled volumes and networks were removed. Two anonymous volumes from an
earlier aborted diagnostic setup could not be attributed with certainty and were left untouched.
Existing user containers were preserved. Raw backup data, migration SQL, environment files and
private certificate material were not committed or posted.

All four findings have the existing `bug` label and appropriate area labels: #158 and #159 cover
Docker/runtime/proxy, #160 database/Docker, and #161 CI/Docker.

Release readiness still requires fixes and successful repeat evidence for the failed gates, the
[security review #72](https://github.com/RentnerKev/RentnerProxy/issues/72),
[UX/accessibility review #74](https://github.com/RentnerKev/RentnerProxy/issues/74), and exact-final-ref
CI/workflow/security checks described in [RELEASING.md](RELEASING.md). Automated authentication and
UI-related tests do not replace manual browser/accessibility or physical passkey-device review.
No release was published and no release-gate issue was closed by this validation.
