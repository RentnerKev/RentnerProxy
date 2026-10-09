# CrowdSec dependency rebuild

Build the complete official v1.8.1 source at commit
`909b5157986a2b2c2163300fdaef5ed01289f7d2`, verified against the SHA256
of its immutable codeload archive. `patch-postgres.sh` migrates both upstream
PostgreSQL driver imports from pgx/v4 to the compatible pgx/v5 `database/sql`
adapter. It rejects unexpected source imports. The committed Go module overlay
pins `github.com/jackc/pgx/v5` to `v5.9.2`, `golang.org/x/net` to `v0.60.0`,
`google.golang.org/grpc` to `v1.83.2` and `golang.org/x/crypto` to `v0.57.0`.
Obsolete pgx/v4, pgproto3/v2, pgconn and pgtype modules are removed. The two
existing CrowdSec replacements (time and coraza) are retained.

The locks were generated with Go 1.27.2, the official Go module proxy and
`sum.golang.org`, followed by `go mod tidy`, `go mod download` and `go mod verify`.
Builds use the committed locks, local Go 1.27.2, readonly module resolution and checks
that neither lock changes. The pinned timestamp is the upstream release time,
not the time of the local rebuild.

Run inside the pinned Linux builder:

```dockerfile
FROM golang:1.27.2-trixie@sha256:e58d6f83b3416618d8bcac2b3dde1b7f7e3c4a77d25e88637f8bbae81536c48d AS crowdsec-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY docker/crowdsec/tooling/engine-build/ /opt/crowdsec-build/
RUN /bin/sh /opt/crowdsec-build/build.sh /out
```

GNU make >= 4.1, tar, sha256sum, grep, awk and ldd must also be available. RE2
is built and installed from the hash-verified official `2023-03-01` archive;
no distribution libre2-dev package is required. The
upstream default profile keeps every component and notification plugin. It
uses CGO, native RE2 and mattn SQLite with `sqlite_omit_load_extension`; it
does not select the system `libsqlite3` backend or the slower WASM RE2 backend.

Outputs are `/out/bin/crowdsec`, `/out/bin/cscli`, `/out/plugins/notification-*`
and `/out/evidence/` containing module locks, source identity and actual binary
buildinfo and the complete package inventory for both commands and every plugin.
Copy binaries into the final runtime. Plugins remain as build evidence;
the managed runtime currently intentionally keeps its plugin directory empty.
No CrowdSec process is started by this script.

The build uses upstream `BUILD_STATIC=1`, retaining native RE2 without adding
shared RE2/libstdc++/SQLite runtime dependencies. The script checks `ldd` on
both outputs and rejects dynamic linkage or missing libraries, storing the
inspection alongside buildinfo. Distribution build-package versions also
affect reproducibility and must follow the owning image policy.

The actual crowdsec/cscli buildinfo must contain Go 1.27.2, every exact patched
module version, CGO and the complete native tag set. Only the two unchanged
official module replacements are allowed. PostgreSQL, MySQL and SQLite remain
available. `verify-packages.sh` requires all three database adapters and rejects
obsolete PostgreSQL packages and every `golang.org/x/crypto/openpgp` package.

GO-2026-5932 affects only the unmaintained OpenPGP packages inside x/crypto.
CrowdSec uses maintained bcrypt, HKDF and OCSP packages from that module; its
build dependency graph does not contain OpenPGP. Scorecard scans Go module
versions without package reachability, so it reports this unused package.
The adjacent `osv-scanner.toml` records only that ID as a false positive until
2026-11-09. The mandatory package guard prevents its introduction into binaries;
all other OSV findings and the existing native binary/image scanner policy remain
active. Review the exception against the saved package inventory and current
advisory before its expiry.

After the real image build, run the existing strict scanners against the resulting
binaries and image. Static contract tests cannot demonstrate native link compatibility
or a clean security scan. This rebuild does not approve image publication.

Upstream references:

- https://github.com/crowdsecurity/crowdsec/releases/tag/v1.8.1
- https://github.com/crowdsecurity/crowdsec/commit/909b5157986a2b2c2163300fdaef5ed01289f7d2
- https://github.com/crowdsecurity/crowdsec/blob/v1.8.1/Makefile
- https://github.com/jackc/pgx/security/advisories/GHSA-j88v-2chj-qfwx
- https://pkg.go.dev/vuln/GO-2026-4518
- https://pkg.go.dev/vuln/GO-2026-5932
- https://pkg.go.dev/vuln/GO-2026-6617
