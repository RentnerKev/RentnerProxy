# Project scripts

Run commands from the repository root. `package.json` is the public entrypoint;
script directories group implementations by their owner.

| Area                                                                | Purpose                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Root `dev.ts`, `dev-core.ts`, `build.ts`, `check.ts`, `test-web.ts` | Development, build and verification orchestration                                      |
| Root `production-backup.ts`, `production-restore.ts`                | Documented backup and restore commands                                                 |
| `backup/`                                                           | Backup format validation and controller archive rules                                  |
| `development/`                                                      | Vite live transport and optional local CrowdSec demo seeder                            |
| `assets/`                                                           | GeoIP download and branded raster accent masks                                         |
| `lib/`                                                              | Logging and command orchestration                                                      |
| `smoke/`                                                            | Shared certificates, proxy, HTTP/3, process, polling, images and scoped Docker helpers |
| `runtime-reliability/`, `runtime-scale/`                            | Independently runnable, bounded runtime verification                                   |
| `compatibility/`                                                    | Immutable release identities for runtime and release compatibility checks              |
| `../.github/scripts/ci/`                                            | CI-only appliance runners, recovery fixtures and release compatibility matrix          |

Useful commands include `bun run dev`, `bun run build`, `bun run test:ts`,
`bun run certificates:smoke` and `bun run upstream-tls:smoke`. See
[Operations](../docs/operations.md#backup-and-recovery) for backup and restore.

`bun run dev` checks the configured controller listen address and Vite's local
port 5173 before starting either process. Stop an existing development session
with Ctrl+C before starting another one. On native Windows, the managed controller
runs without Caddy and the web process pauses proxy/CrowdSec reconciliation;
pending proxy changes still require the Linux Docker runtime to be applied.
The launcher sets the internal `RENTNERPROXY_NATIVE_CONTROLLER_DEV` marker for
this session. Production and Unix runtimes keep reconciliation enabled.
`bun run dev:web` starts the web process independently for an existing controller.

`bun run check` runs format, lint, Web/script type checks, ordinary TypeScript
tests, Clippy and Rust tests. `bun run check:full` adds fuzz tests and production
builds; the Web build performs its type check after generated build types exist.
Both modes leave database checks/migrations to explicit commands. CI checks
scripts separately and Web types once in the production build; Rust compilation
is covered by Clippy, tests and the release build.

Without a configured database URL, ordinary unit tests use a synthetic URL on
port 1 so modules can construct their lazy SQL client. Unit probes remain injected;
database integration tests require their explicitly configured fixture database.

Production Smokes opts into `smoke/images.ts` to build the proxy runtime, appliance
and HTTP/3 client once. Reuse requires a validated run scope and matching source
revision/image labels. Consumers keep shared images until final scoped cleanup;
standalone commands keep independent builds and cleanup.

Fresh-install and Beta-1-to-candidate checks run in the dedicated release
compatibility workflow. The published Beta 1 identity remains pinned in
`compatibility/published-releases.ts`; `compatibility/published-tools.ts` lists
the source backup/restore dependencies fetched together from that revision.
Alpha sources are no longer selected. See [the upgrade path](../docs/operations.md#upgrades).
