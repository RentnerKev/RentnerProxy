# Operations

## Runtime dependency maintenance

The web runtime stages remove build tools and their native platform packages after
the frozen production install. Application runtime packages remain installed.
Both custom Caddy builds use the pinned 2.11.7 builder and CrowdSec SDK v1.7.8,
while retaining the verified HTTP-only community bouncer source revision.
The source transform also adapts its live decision IP filter to the SDK's string
field without changing exact-match filtering.
The appliance updates its inherited PCRE2 package from the configured Debian
repositories and rejects builds below `10.46-1~deb13u3`.
These updates do not establish that an image passes the complete dependency
assessment; unresolved findings continue to block publication.

## CrowdSec (development image)

- **Managed:** local detection and blocking work without a CrowdSec account; community intelligence and Console enrollment are separate opt-ins.
- **External:** connect an existing CrowdSec Local API with a bouncer key.
- **Disabled:** default; existing traffic behavior is unchanged.
- Flags use a bundled country-only MMDB. A mounted GeoLite2 Country file can be selected with the optional `RENTNERPROXY_GEOIP_COUNTRY_DB_PATH` (absolute path; maintain its license and updates).
- Enforcement is fail-open when the selected Local API is unavailable.
- Repository backup v4 includes the managed CrowdSec SQLite database, decisions, local API registration, optional Central API/Console credentials and managed bouncer key. External CrowdSec configuration and its encrypted credential are in PostgreSQL; the external LAPI remains operator owned.

## Basic Auth (development image)

Create an Access Policy, choose **Authenticated** and **Basic Auth**, enter a username and password, and save. The policy and its first account are saved together and applied automatically. Select the policy on the proxy host and save the host to require these credentials when visiting the site. If the controller is unavailable, the UI reports that applying the saved configuration is still pending. Use **Credentials** in the policy list to change credentials or add more accounts. Passwords are stored as Argon2id hashes and are never returned to the browser. Use HTTPS on protected hosts.

## Forward Auth (development image)

Forward Auth is configured inside an existing Access Policy. Choose a provider preset, enter its full HTTP or HTTPS check endpoint, and select the request credentials and identity response headers needed by that provider. Basic Auth and Forward Auth are mutually exclusive in one policy. An IP rule can be combined with Forward Auth only when **all** checks must pass. The auth check is fail closed: a denied response or unreachable gateway never grants access to the protected upstream. HTTPS auth gateways use normal certificate verification; the endpoint cannot contain credentials or a query string.

Provider reachability is not measured by the Security Dashboard; it reports configured policy counts and settings only.

## Default Site (development image)

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

## Backup and recovery

Run `bun run backup:production -- --project <project> --output <directory>` with the current checkout and the deployment's Compose environment. The appliance is stopped while PostgreSQL, controller/certificate state, the application encryption key and managed CrowdSec state are captured together, then restarted. Keep the completed backup directory outside the appliance volume. Its manifest records SHA-256 checksums, the source image identity, public origin and trusted proxy CIDRs; the directory is private (0700) and its files are 0600 on Linux. Checksums detect corruption, so retain backups in trusted storage.

Restore with `bun run restore:production -- --project <project> --input <backup> --confirm-replace`. Restore validates the complete manifest and immutable copies of every artifact before stopping the target. It rejects unsafe archive members, incompatible migration history, corrupted databases and application keys that cannot decrypt persisted secrets. Archive extraction uses private staging directories and repairs ownership before startup. The restored desired configuration is reconciled by the controller; verify the appliance health and actual proxy traffic before accepting recovery.

Controller restart recovery requires the active policy snapshot and its matching `active-proxy-snapshot-authority-v1` file, with no pending activation marker. Confirmed configurations remain recoverable while the web service is offline. On the first startup after upgrading a build that predates this protocol, cached routes wait for the web service to reapply desired configuration. Complete controller backups retain the snapshot, authority file and pending marker together; do not restore or copy the snapshot alone.

Supported restore sources are current v4 backups into the same current database version, and authentic v3 backups from the pinned published Alpha 4, Alpha 5 and Alpha 6 images into the current target. The [release compatibility matrix](../scripts/release-compatibility/run.ts) creates each source backup with that release's own tools, verifies fresh-volume restores and exact-source fresh-volume rollback. Format v1/v2, other releases and downgrades are unsupported; changing a manifest version does not make a backup compatible. Alpha v3 archives predate managed CrowdSec. They initialize CrowdSec on a fresh target and leave any existing CrowdSec directory in place; they cannot recover lost decisions.

Keep the Compose file, image tag/digest, port mappings and deployment environment alongside the backup, including SMTP credentials, canonical public origin and trusted proxy CIDRs. Environment secrets are deliberately absent from the manifest. A v4 restore checks the origin and CIDRs against the target; legacy v3 restores require explicit deployment review with `--allow-deployment-change`. Use that option for an intentional environment change only after reviewing authentication, forwarded-client trust and external integration reachability.

Valkey challenge/rate-limit/realtime state, request logs, sockets, PID files, locks, temporary files and supervisor status/staging are excluded. Cache-backed flows restart after restore; durable users, sessions, roles, permissions, policies, Basic Auth, Forward Auth, importer history, hosts, redirects, CAs, certificate jobs/events/retries, candidates, ACME accounts and encrypted DNS credentials remain in PostgreSQL/controller state. Backup v4 retains its historical `redis: "excluded"` manifest field for compatibility; it describes the transient cache exclusion for both engines. CrowdSec's SQLite WAL is retained when present, while its shared-memory file is regenerated. Managed startup re-registers the bouncer with a private key and preserves detections and registrations; the LAPI remains bound to loopback.

If restore is interrupted after replacement begins, the persistent journal prevents startup with partially restored state. Stop the appliance if it was manually started and rerun the same backup with `--resume --confirm-replace`. Resume validates that backup again and repeats all replacement steps. Another backup is rejected while the journal is pending. A failure before replacement leaves the running target intact; no automatic destructive retry is attempted. For rollback, use a fresh volume, the pre-upgrade source backup, that source release's restore tools and its exact image digest.

## Dependency advisory gates

`Deployed Dependency Security` audits the complete `core/Cargo.lock` on PRs,
main pushes and daily at 04:17 UTC. PR/main candidates are built as isolated
production OCI archives and assessed without starting the appliance. Existing
JavaScript auditing and dependency review remain separate checks.

The PR/main image check establishes complete assessment coverage. A completed
assessment with blocking advisories reports **publication blocked** in the job
summary and stores `blocked-assessment.json`; it does not approve a release.
Missing inventories, malformed reports, stale databases and scanner failures
fail the check. The release/dev build and trusted publisher enforce the full
advisory policy with a nonzero exit, and only a fresh `approved` assessment
bound to the independently checked source and digest can authorize publication.

Release and dev builds have read-only repository permission and no registry
publishing token. They export an OCI archive including SBOM/provenance, assess
it locally, and record its source commit, OCI index digest and archive checksum.
Candidates have one unnamed OCI root; channel/version tags are assigned only by
the publisher, avoiding ambiguous multi-name archive roots.
A separate trusted publisher verifies the checksum, independently reassesses
the exact archive, then copies it with `skopeo --all --preserve-digests`. Each
published tag is checked against the assessed index digest. No candidate is
uploaded to the public registry before this gate passes; failing assessment
prevents both image publication and the subsequent release-note upload.

The complete merged runtime is catalogued with Syft, including Debian packages,
JavaScript packages, Bun, Valkey and copied Go binaries. Missing expected runtime
inventory fails the check. Grype blocks medium/moderate, high, critical and
unknown severity findings, including those without a fix. Cargo blocks every
RustSec vulnerability. Actual Caddy, CrowdSec and cscli binaries are extracted
from a stopped container and checked with govulncheck; module/package findings
and symbol traces are retained, and every Go finding blocks publication. Caddy's
HTTP-only local community-module replacement is additionally queried using its
original version embedded in the binary, so local replacement paths cannot
silently evade upstream advisory checks. Binary reports can conservatively fall
back to module-level advisory symbols when binaries are stripped; these do not
prove actual symbol reachability. Such findings still block publication pending
an exact-build reachability assessment or remediation.

The daily rescan resolves `dev` and the newest non-draft release in each
alpha/beta/stable channel to immutable digests once and assesses those digests.
These channel images are monitored for dependency advisories; security-fix
support remains limited to current `main` as described in `SECURITY.md`.
The canonical published Alpha6 source commit and OCI index digest together
select its historical Redis/Caddy-only inventory and `controller/Cargo.lock`
data path. The selected identity and settings are retained in `profile.json`.
Every other source/digest pair requires the current Valkey/CrowdSec runtime.
This changes expected historical components only; the same full OS/npm,
scanner/database, RustSec and Go advisory policy remains mandatory. Historical
source is never executed; only lock data at the validated revision is fetched.
PRs changing security scripts or the dependency workflow also rescan the
deployed channels before merge. Only this PR coverage check may report a
complete adverse assessment as successful coverage; scheduled and manually
dispatched rescans still fail for blocking advisories. Invalid or incomplete
assessments always fail, including an empty monitored-tag list.
Historical superseded tags are not covered. A missing monitored tag, download/scanner error,
malformed report or stale advisory database fails closed. Grype's maximum build
age is 48 hours; Go's official advisory index may remain unchanged between
advisories and has a seven-day maximum last-modified age. Both require successful
fresh retrieval and valid database metadata. RustSec is cloned freshly for each
locked-graph audit; the database revision and lock checksum are retained.

The audit keeps cargo-audit's database fetch and crates.io index refresh enabled,
requires its reported advisory commit to match the Git checkout after auditing,
and retains stderr diagnostics. Null database metadata, missing/index-refresh
errors and advisory/yanked-package warnings fail closed, even when cargo-audit
returns zero or its vulnerability count is zero. The advisory database is fetched
within 48 hours and its last commit must be within seven days.
In [cargo-audit 0.22.2](https://github.com/RustSec/rustsec/blob/cargo-audit/v0.22.2/cargo-audit/src/auditor.rs),
`--no-fetch` also suppresses index refresh and opens advisory files without Git
metadata; this gate deliberately retains the default fetch mode.

New images embed the exact Cargo lock; older channel images fetch only that lock
data from their exact source commit. No historical
source scripts or appliance entrypoints are executed.

Assessment artifacts retain source/image identity, scanner versions/database
identity, full inventories, RustSec reports and Go findings for 30 days. No
exceptions or ignored/unfixed filters are enabled. Any future exception requires
a separately reviewed advisory-specific reason, responsible owner and expiry;
it must not silently disable a scanner or lower the global severity policy.

Tool pins verified against upstream on 2026-10-06: [Grype 0.120.0](https://github.com/anchore/grype/releases/tag/v0.120.0),
[Syft 1.54.1](https://github.com/anchore/syft/releases/tag/v1.54.1),
[Go 1.27.1](https://go.dev/dl/), [govulncheck 1.8.0](https://pkg.go.dev/golang.org/x/vuln@v1.8.0/cmd/govulncheck)
and [cargo-audit 0.22.2](https://crates.io/crates/cargo-audit/0.22.2).
Downloaded archives use pinned upstream SHA-256 checksums; Go modules and
Cargo installation use their ecosystem checksum verification and locked versions.
