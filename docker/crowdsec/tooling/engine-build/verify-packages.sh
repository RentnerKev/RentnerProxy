#!/bin/sh
set -eu

packages=${1:?Usage: verify-packages.sh PACKAGE_INVENTORY}
for datasource in appsec cloudwatch docker file http journalctl kafka kinesis \
    kubernetes kubernetesaudit loki s3 syslog victorialogs wineventlog; do
    grep -Fxq "github.com/crowdsecurity/crowdsec/pkg/acquisition/modules/$datasource" "$packages"
done
grep -Fxq 'github.com/go-sql-driver/mysql' "$packages"
grep -Fxq 'github.com/mattn/go-sqlite3' "$packages"
if grep -Eq '^github\.com/jackc/(pgx/v4|pgproto3/v2|pgconn|pgtype)(/|$)|^golang\.org/x/crypto/openpgp(/|$)' "$packages"; then
    echo 'The CrowdSec build includes an obsolete PostgreSQL or OpenPGP package' >&2
    exit 1
fi
