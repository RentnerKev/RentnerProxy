# Operations

## Runtime dependency maintenance

The web runtime stages remove build tools and their native platform packages after
the frozen production install. Application runtime packages remain installed.
Both custom Caddy builds use the pinned 2.11.7 builder, Go 1.27.2 and CrowdSec SDK v1.8.1,
while retaining the verified HTTP-only community bouncer source revision.
The source transform also adapts its live decision IP filter to the SDK's string
field without changing exact-match filtering.
The appliance updates its inherited PCRE2 package from the configured Debian
repositories and rejects builds below `10.46-1~deb13u3`.
CrowdSec and cscli are rebuilt from the pinned upstream 1.8.1 source archive
using the full upstream static feature profile and RE2 2023-03-01. Reviewed,
read-only module locks update gRPC to 1.84.0 and `golang.org/x/crypto` to 0.58.0;
the build verifies both binaries' embedded dependency versions. The official
image continues to supply configuration and the pinned Hub assets.
The [engine build notes](../docker/crowdsec/tooling/engine-build/README.md)
explain the remaining RE2 and Kubernetes compatibility pins. Axum 0.8.9 also
requires its exact matchit 0.8.4 dependency; the current stable dependency
refresh retains these upstream constraints.
These updates do not establish that an image passes the complete dependency
assessment; unresolved findings continue to block publication.

## CrowdSec

- **Managed:** local detection and blocking work without a CrowdSec account; community intelligence and Console enrollment are separate opt-ins.
- **External:** connect an existing CrowdSec Local API with a bouncer key.
- **Disabled:** default; existing traffic behavior is unchanged.
- Flags use a bundled country-only MMDB. A mounted GeoLite2 Country file can be selected with the optional `RENTNERPROXY_GEOIP_COUNTRY_DB_PATH` (absolute path; maintain its license and updates).
- Enforcement is fail-open when the selected Local API is unavailable.
- Repository backup v4 includes the managed CrowdSec SQLite database, decisions, local API registration, optional Central API/Console credentials and managed bouncer key. External CrowdSec configuration and its encrypted credential are in PostgreSQL; the external LAPI remains operator owned.

## Basic Auth

Create an Access Policy, choose **Authenticated** and **Basic Auth**, enter a username and password, and save. The policy and its first account are saved together and applied automatically. Select the policy on the proxy host and save the host to require these credentials when visiting the site. If the controller is unavailable, the UI reports that applying the saved configuration is still pending. Use **Credentials** in the policy list to change credentials or add more accounts. Passwords are stored as Argon2id hashes and are never returned to the browser. Use HTTPS on protected hosts.

## Forward Auth

Forward Auth is configured inside an existing Access Policy. Choose a provider preset, enter its full HTTP or HTTPS check endpoint, and select the request credentials and identity response headers needed by that provider. Basic Auth and Forward Auth are mutually exclusive in one policy. An IP rule can be combined with Forward Auth only when **all** checks must pass. The auth check is fail closed: a denied response or unreachable gateway never grants access to the protected upstream. HTTPS auth gateways use normal certificate verification; the endpoint cannot contain credentials or a query string.

Provider reachability is not measured by the Security Dashboard; it reports configured policy counts and settings only.

## Default Site

Open **Operations** in the main navigation to choose the Default Site response for the server's IP address or a hostname
with no active Proxy Host or Redirect Host. Existing installations keep the empty HTTP 404 response
until an administrator saves another mode. Owners and administrators have the dedicated
`default_site.view` and `default_site.update` permissions; saving also requires `proxy_hosts.apply`.
Custom roles may receive these permissions through role management.

| Mode             | Unmatched request behavior                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| 404              | HTTP 404, preserving the existing default.                                                              |
| Welcome page     | Built-in RentnerProxy HTML page, HTTP 200.                                                              |
| Close connection | Caddy aborts the connection without an HTTP response. No HTTP 444 is sent.                              |
| Redirect         | HTTP 302 to the exact configured absolute HTTP/HTTPS URL; the incoming path and query are not appended. |
| Custom HTML      | The saved HTML, HTTP 200 with `Content-Type: text/html; charset=utf-8`.                                 |

Custom HTML is limited to 256 KiB of UTF-8 text. Edit it as source on the Operations page; it is never rendered
inside the management UI. The public page uses a sandboxed Content Security Policy: scripts,
forms, frames and navigation privileges are disabled; inline styles and HTTP/HTTPS/data images
are allowed. Caddy placeholders, including `{env.*}` and `{file.*}`, are served literally.
Redirect targets reject credentials, control characters and unsupported URL schemes. HTML and
redirect responses disable caching. The close mode follows Caddy's
[abort behavior](https://caddyserver.com/docs/caddyfile/directives/abort), which also interrupts
other active HTTP streams on the same connection.

For HTTP, point the hostname's DNS record at the server or open its IP address on the published
HTTP port. Existing hosts, redirects and access policies take precedence; ACME challenge handling
and the separate management endpoint remain in their existing routing paths.

HTTPS requires a successful TLS handshake before any Default Site response can be delivered.
This setting does not request a certificate, add a default certificate, enable on-demand TLS or
expand the configured SNI policies. The HTTPS listener exists only when a configured host has
certificate material. Unknown names and IP addresses normally fail the handshake, and a Host/SNI
mismatch is still rejected. A Default Site selection cannot solve these certificate limitations;
configure a host and a suitable certificate when visitors need HTTPS for that address.

The selected mode and custom HTML are durable PostgreSQL settings, included in the supported
appliance backup/restore. The controller also persists the active snapshot for restart recovery.
Saving reports when runtime application is pending; the existing reconciliation worker retries
automatically. Reload Operations after a configuration conflict before saving another edit.
Portable host configuration exports do not include these global settings.

## Upgrades

Beta 2 and later supported betas require Beta 1 (`v1.0.0-beta.1`) or a newer
supported beta as their upgrade source. The compatibility workflow tests a fresh
installation and the immutable published Beta 1 image against the candidate.

Before each upgrade, create a backup with the source release's own tools and keep
its exact image reference, Compose configuration, deployment environment and
encryption material. Change the image only after the backup completes. Preserve
the existing volume and verify health, proxy traffic, certificates, permissions
and configuration reconciliation after startup.

For an Alpha installation, first select
`ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.1`, complete its startup and
reconciliation, verify the installation and create a new v4 backup. Then select
the intended beta image. Do not use the moving `:beta` tag for the intermediate
step. Alpha v3 backups must first be restored into Beta 1 with that pinned
release's restore tools, then backed up again as v4 before proceeding.

Direct Alpha upgrades, direct v3 restores and import of old environment-file
secrets are unsupported from Beta 2 onward. Existing installations must retain
their persistent `bootstrap/secrets-v1.json`; missing secret state stops startup
instead of generating replacement keys. A Beta 1 start does not guarantee that
every certificate state file has been rewritten, so the existing Beta 1
certificate-reader compatibility remains available.

For rollback, use the pre-upgrade backup, the exact source image and source
release's restore tools on a fresh volume. Do not run an old image against the
upgraded database.

## Backup and recovery

Run `bun run backup:production -- --project <project> --output <directory>` with the current checkout and the deployment's Compose environment. The appliance is stopped while PostgreSQL, controller/certificate state, the application encryption key and managed CrowdSec state are captured together, then restarted. Keep the completed backup directory outside the appliance volume. Its manifest records SHA-256 checksums, the source image identity, public origin and trusted proxy CIDRs; the directory is private (0700) and its files are 0600 on Linux. Checksums detect corruption, so retain backups in trusted storage.

Restore with `bun run restore:production -- --project <project> --input <backup> --confirm-replace`. Restore validates the complete manifest and immutable copies of every artifact before stopping the target. It rejects unsafe archive members, incompatible migration history, corrupted databases and application keys that cannot decrypt persisted secrets. Archive extraction uses private staging directories and repairs ownership before startup. The restored desired configuration is reconciled by the controller; verify the appliance health and actual proxy traffic before accepting recovery.

Controller restart recovery requires the active policy snapshot and its matching `active-proxy-snapshot-authority-v1` file, with no pending activation marker. Confirmed configurations remain recoverable while the web service is offline. On the first startup after upgrading a build that predates this protocol, cached routes wait for the web service to reapply desired configuration. Complete controller backups retain the snapshot, authority file and pending marker together; do not restore or copy the snapshot alone.

Supported restore sources are v4 backups with a database history compatible with the current target. The database version must match the target's current migration history. The [release compatibility matrix](../.github/scripts/ci/release-compatibility/run.ts) creates a backup with the pinned Beta 1 release's own tools, verifies a fresh-volume target restore and exact-source fresh-volume rollback. Formats v1/v2/v3, unlisted source releases and downgrades are unsupported; changing a manifest version does not make a backup compatible. Use the Beta 1 intermediate step above for Alpha v3 archives.

Keep the Compose file, image tag/digest, port mappings and deployment environment alongside the backup, including SMTP credentials, canonical public origin and trusted proxy CIDRs. Environment secrets are deliberately absent from the manifest. A v4 restore checks the origin and CIDRs against the target. Use `--allow-deployment-change` for an intentional environment change only after reviewing authentication, forwarded-client trust and external integration reachability.

Valkey challenge/rate-limit/realtime state, request logs, sockets, PID files, locks, temporary files and supervisor status/staging are excluded. Cache-backed flows restart after restore; durable users, sessions, roles, permissions, policies, Basic Auth, Forward Auth, importer history, hosts, redirects, CAs, certificate jobs/events/retries, candidates, ACME accounts and encrypted DNS credentials remain in PostgreSQL/controller state. Backup v4 retains its historical `redis: "excluded"` manifest field for compatibility; it describes the transient cache exclusion for both engines. CrowdSec's SQLite WAL is retained when present, while its shared-memory file is regenerated. Managed startup re-registers the bouncer with a private key and preserves detections and registrations; the LAPI remains bound to loopback.

If restore is interrupted after replacement begins, the persistent journal prevents startup with partially restored state. Stop the appliance if it was manually started and rerun the same backup with `--resume --confirm-replace`. Resume validates that backup again and repeats all replacement steps. Another backup is rejected while the journal is pending. A failure before replacement leaves the running target intact; no automatic destructive retry is attempted. For rollback, use a fresh volume, the pre-upgrade source backup, that source release's restore tools and its exact image digest.

## Dependency advisory gates

`Deployed Dependency Security` audits RentnerProxy's complete locked Cargo and
Bun graphs on PRs and main pushes. All RustSec vulnerabilities and Bun advisories
at moderate severity or above block the check. Missing, malformed, inconsistent
or incomplete own-dependency evidence also fails.

Debian, PostgreSQL, Valkey, Caddy, CrowdSec, cscli and their Go modules are outside
this advisory assessment. Separate Syft, Grype, govulncheck and historical release
scans are removed. Upstream images/packages remain managed dependencies; tests
still cover RentnerProxy's configuration and integration with them. A green gate
confirms only the own Cargo/Bun scope.

Image assessment extracts embedded lock data from a stopped container without
starting the appliance. The exact Cargo lock and web package manifest/Bun lock
must be present; there is no historical source-lock fallback.

Bun audits retain unfiltered JSON, raw exit status, stderr diagnostics and
lock/manifest checksums. Only copied manifests and lockfiles run in an isolated
temporary workspace, preventing package-manager dotenv loading from importing
deployment configuration. Transport errors, skipped registries and invalid or
inconsistent entries fail. Cargo keeps database fetching and crates.io index
refresh enabled, records lock checksum/RustSec Git revision and validates
database metadata against that revision. Index errors, yanked/advisory warnings
and null metadata fail even when the scanner exits zero. RustSec must be fetched
within 48 hours and its last commit within seven days.

PR/main candidates are isolated production OCI archives. Dev and release builders
have read-only repository permissions and no publishing token. They record exact
source commit, OCI index digest and archive checksum, retaining SBOM/provenance.
A separate trusted publisher verifies the checksum and repeats the own-dependency
assessment before registry login. Only a fresh `own-dependencies-approved` record
with scope `rentnerproxy-locked-cargo-and-bun`,
`externalRuntimePolicy: informational` and the exact source/digest permits
publication. The policy marker describes components outside the gate; it does
not imply upstream scanners run. Legacy full-image approvals and old Dev waivers
are rejected. Every channel uses the same scope. The publisher copies with
`skopeo --all --preserve-digests` and verifies each tag's digest.

The daily 04:17 UTC rescan and manual runs resolve only `:dev` once to an immutable
digest. Own Cargo/Bun findings block it. Invalid identities, missing embedded locks
and incomplete audits fail. PRs changing scanner integration also run this Dev
rescan. The daily run builds no image and scans no historical releases.

`rescan-summary.md` records the Dev source revision, digest and result in the
artifact and job summary. Blocked records remain evidence and cannot authorize
publication. Rerunning a scan cannot patch an immutable image; an update requires
publishing a newly assessed replacement. Evidence artifacts are retained for
30 days.

Cargo uses locked `cargo-audit 0.22.2`; image helpers require `skopeo`.
Required-tool installation failures fail the assessment. See
[the workflow overview](../.github/WORKFLOWS.md) for ownership and required checks.
