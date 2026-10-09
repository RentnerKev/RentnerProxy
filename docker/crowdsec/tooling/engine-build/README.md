# CrowdSec dependency rebuild

Build the complete official v1.8.1 source at commit
`909b5157986a2b2c2163300fdaef5ed01289f7d2`, verified against the SHA256
of its immutable codeload archive. `patch-postgres.sh` migrates both upstream
PostgreSQL driver imports from pgx/v4 to the compatible pgx/v5 `database/sql`
adapter. It rejects unexpected source imports. The committed Go module overlay
pins `github.com/jackc/pgx/v5` to `v5.11.0`, `golang.org/x/net` to `v0.61.0`,
`google.golang.org/grpc` to `v1.84.0` and `golang.org/x/crypto` to `v0.58.0`.
Obsolete pgx/v4, pgproto3/v2, pgconn and pgtype modules are removed. The
CrowdSec time replacement remains at its latest published fork release,
`v0.13.0-crowdsec.20250912`. Coraza uses the latest published CrowdSec fork,
`v3.8.0-crowdsec.20261002`. These replacements retain the upstream engine's
required behavior.

The October 2026 refresh updates 44 direct and 90 indirect requirements,
including AWS SDK, Gin 1.12.0, Prometheus 1.25.0, mattn SQLite 1.14.52,
modernc SQLite 1.60.1 and Kubernetes 0.37.1. Kubernetes requires the compatible
`k8s.io/kube-openapi` revision `v0.0.0-20260721132016-d427ff9ee9ad`, as declared
by `k8s.io/apimachinery v0.37.1`. The newer October 7 revision uses
`structured-merge-diff/v7` schemas while Kubernetes 0.37.1 uses v6; a real
engine build fails with incompatible schema types. Keep that compatible
revision until Kubernetes adopts the new schema API.

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

The native RE2 pin is a compatibility exception, not the latest upstream
release. Google's latest stable release checked on October 9, 2026 is
`2025-11-05` (archive SHA256
`87f6029d2f6de8aa023654240a03ada90e876ce9a4676e258dd01ea4c26ffd67`). An isolated
build with the pinned Debian 13 builder fails at missing
`absl/log/absl_check.h`: newer RE2 requires an additional Abseil native build
and static link graph. The current `go-re2 v1.13.0` native bridge still uses
`re2::StringPiece`, while the latest RE2 header exposes `absl::string_view`.
Updating this pin requires a separately verified bridge and Abseil integration;
the existing static native backend remains enabled. RE2's June 2023 release
already requires Abseil, so March 2023 is the current standalone-build limit.

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
module version, CGO and the complete native tag set. Only the two pinned
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
- https://github.com/google/re2/releases/tag/2025-11-05
- https://github.com/google/re2/blob/2023-06-01/Makefile
- https://github.com/wasilibs/go-re2/blob/v1.13.0/internal/cre2/cre2.cpp
- https://github.com/kubernetes/apimachinery/blob/v0.37.1/go.mod
