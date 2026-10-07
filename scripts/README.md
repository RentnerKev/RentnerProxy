# Project scripts

Run project commands from the repository root. `package.json` remains the public
entrypoint; the script directories group implementations by their owner.

| Area                                                 | Purpose                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Root `dev.ts`, `build.ts`, `check.ts`, `test-web.ts` | Product development, build and verification orchestration                                 |
| Root `production-backup.ts`, `production-restore.ts` | The documented backup and restore commands                                                |
| `backup/`                                            | Backup format validation and controller archive rules                                     |
| `development/`                                       | Vite live transport and the optional local CrowdSec demo seeder                           |
| `assets/`                                            | GeoIP download and regeneration of branded raster accent masks                            |
| `lib/`                                               | Logging and command orchestration shared by root entrypoints                              |
| `smoke/`                                             | Shared certificates, proxy, HTTP/3, process, polling and scoped Docker helpers            |
| `runtime-reliability/`, `runtime-scale/`             | Independently runnable, bounded runtime verification                                      |
| `compatibility/`                                     | Immutable published release identities shared by runtime and security checks              |
| `../.github/scripts/ci/`                             | CI-only appliance runners, upgrade/recovery fixtures and the release compatibility matrix |

Useful commands include `bun run dev`, `bun run build`, `bun run test:ts`,
`bun run certificates:smoke` and `bun run upstream-tls:smoke`. Backup and restore
usage is documented in [Operations](../docs/operations.md#backup-and-recovery).
`check` also includes the project's database-history check; it is not a substitute
for selecting the checks permitted in a particular working environment.

Upgrade and persistence fixtures are named for their responsibility rather than
the release where they were introduced. Supported historical Alpha images remain
pinned in `compatibility/published-releases.ts`. The CI compatibility runner fetches
historical backup/restore helpers from their original paths at each pinned revision.
