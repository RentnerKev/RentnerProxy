#!/bin/sh

set -eu

source_root=$1

# SDK v1.7.8 uses a string for the live decision IP filter. Keep the same
# exact-match filter while adapting the verified v0.14.1 bouncer source.
grep -Eq '^[[:space:]]*IPEquals: &value,$' "$source_root/internal/bouncer/live.go"
sed -i 's/IPEquals: \&value,/IPEquals: value,/' "$source_root/internal/bouncer/live.go"

sed -i \
    '/always include AppSec module when HTTP is added/d' \
    "$source_root/http/http.go"
sed -i \
    -e '/^[[:space:]]*"fmt"$/d' \
    -e '/^[[:space:]]*l4 "github.com\/mholt\/caddy-l4\/layer4"$/d' \
    -e '/^\/\/ FromConnection extracts the current server name from the$/,/^}$/d' \
    "$source_root/internal/servername/servername.go"

gofmt -w \
    "$source_root/internal/bouncer/live.go" \
    "$source_root/http/http.go" \
    "$source_root/internal/servername/servername.go"
