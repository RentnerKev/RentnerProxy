#!/bin/sh
set -eu

source_root=${1:?Usage: patch-postgres.sh SOURCE_DIRECTORY}
for source in pkg/database/drv_postgres.go pkg/database/alerts_pg_race_test.go; do
    filename="$source_root/$source"
    if test "$(grep -Ec '^[[:space:]]*_ "github[.]com/jackc/pgx/v4/stdlib"$' "$filename")" -ne 1; then
        echo "Unexpected upstream PostgreSQL import in $source" >&2
        exit 1
    fi
    sed -i 's|github.com/jackc/pgx/v4/stdlib|github.com/jackc/pgx/v5/stdlib|' "$filename"
done
