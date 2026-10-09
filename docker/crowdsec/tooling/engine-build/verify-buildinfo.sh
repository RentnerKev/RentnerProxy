#!/bin/sh
set -eu

buildinfo=${1:?Usage: verify-buildinfo.sh BUILDINFO_FILE}
# Inspect actual binaries, rather than trusting go.mod or a version banner.
grep -Eq '^.*: go1\.27\.2$' "$buildinfo"
awk '
    $1 == "dep" { module = $2 }
    $1 == "dep" && $2 == "google.golang.org/grpc" && $3 == "v1.84.0" { grpc++ }
    $1 == "dep" && $2 == "golang.org/x/crypto" && $3 == "v0.58.0" { crypto++ }
    $1 == "dep" && $2 == "golang.org/x/net" && $3 == "v0.61.0" { net++ }
    $1 == "dep" && $2 == "github.com/jackc/pgx/v5" && $3 == "v5.11.0" { pgx++ }
    $1 == "dep" && $2 ~ /^github[.]com\/jackc\/(pgx\/v4|pgproto3\/v2|pgconn|pgtype)$/ { obsolete++ }
    $1 == "=>" && !(module == "golang.org/x/time" && $2 == "github.com/crowdsecurity/time" && $3 == "v0.13.0-crowdsec.20250912") && !(module == "github.com/corazawaf/coraza/v3" && $2 == "github.com/crowdsecurity/coraza/v3" && $3 == "v3.8.0-crowdsec.20261002") { replaced++ }
    END { exit !(grpc == 1 && crypto == 1 && net == 1 && pgx == 1 && obsolete == 0 && replaced == 0) }
' "$buildinfo"
grep -Eq '^[[:space:]]*build[[:space:]]+CGO_ENABLED=1$' "$buildinfo"
grep -Eq '^[[:space:]]*build[[:space:]]+-tags=netgo,osusergo,expr_debug,nomsgpack,sqlite_omit_load_extension,re2_cgo$' "$buildinfo"
