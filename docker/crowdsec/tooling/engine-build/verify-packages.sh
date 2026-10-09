#!/bin/sh
set -eu

packages=${1:?Usage: verify-packages.sh PACKAGE_INVENTORY}
grep -Fxq 'github.com/jackc/pgx/v5/stdlib' "$packages"
grep -Fxq 'github.com/go-sql-driver/mysql' "$packages"
grep -Fxq 'github.com/mattn/go-sqlite3' "$packages"
if grep -Eq '^github\.com/jackc/(pgx/v4|pgproto3/v2|pgconn|pgtype)(/|$)|^golang\.org/x/crypto/openpgp(/|$)' "$packages"; then
    echo 'The CrowdSec build includes an obsolete PostgreSQL or OpenPGP package' >&2
    exit 1
fi
