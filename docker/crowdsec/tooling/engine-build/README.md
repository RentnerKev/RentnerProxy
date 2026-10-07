# CrowdSec dependency rebuild

Build the complete official v1.8.1 source at commit
`909b5157986a2b2c2163300fdaef5ed01289f7d2`, verified against the SHA256
of its immutable codeload archive. The committed Go module overlay updates
`google.golang.org/grpc` to `v1.83.2` and `golang.org/x/crypto` to `v0.57.0`.
Go minimum-version selection also updates x/mod, x/sync, x/sys, x/term and
x/text. The two existing CrowdSec replacements (time and coraza) are retained.

The locks were generated with Go 1.27.1, the official Go module proxy and
`sum.golang.org`, followed by `go mod download` and `go mod verify`. Builds use
the committed locks, local Go 1.27.1, readonly module resolution and checks
that neither lock changes. The pinned timestamp is the upstream release time,
not the time of the local rebuild.

Run inside the pinned Linux builder:

```dockerfile
FROM golang:1.27.1-trixie@sha256:8f58fd67ea075142d947a60e0caa4317746a55118d312f027793d382c7741734 AS crowdsec-build
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
buildinfo. Copy binaries into the existing upstream asset stage before its
cscli commands, and into the final runtime. Plugins remain as build evidence;
the managed runtime currently intentionally keeps its plugin directory empty.
No CrowdSec process is started by this script.

The build uses upstream `BUILD_STATIC=1`, retaining native RE2 without adding
shared RE2/libstdc++/SQLite runtime dependencies. The script checks `ldd` on
both outputs and rejects dynamic linkage or missing libraries, storing the
inspection alongside buildinfo. Distribution build-package versions also
affect reproducibility and must follow the owning image policy.

The actual crowdsec/cscli buildinfo must contain Go 1.27.1, both exact patched
versions, CGO and the complete native tag set. Only the two unchanged official
module replacements are allowed. The existing PostgreSQL/MySQL drivers and
OpenPGP functionality remain present. Their known advisories remain open;
this rebuild neither suppresses findings nor approves image publication.

After the real image build, run the existing strict scanners against the
resulting binaries and image. Static contract tests cannot demonstrate native
link compatibility or a clean security scan.

Upstream references:

- https://github.com/crowdsecurity/crowdsec/releases/tag/v1.8.1
- https://github.com/crowdsecurity/crowdsec/commit/909b5157986a2b2c2163300fdaef5ed01289f7d2
- https://github.com/crowdsecurity/crowdsec/blob/v1.8.1/Makefile
