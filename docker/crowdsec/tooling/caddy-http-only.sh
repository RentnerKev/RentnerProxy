#!/bin/sh

set -eu

source_root=$1

sed -i \
    '/always include AppSec module when HTTP is added/d' \
    "$source_root/http/http.go"
sed -i \
    -e '/^[[:space:]]*"fmt"$/d' \
    -e '/^[[:space:]]*l4 "github.com\/mholt\/caddy-l4\/layer4"$/d' \
    -e '/^\/\/ FromConnection extracts the current server name from the$/,/^}$/d' \
    "$source_root/internal/servername/servername.go"

gofmt -w \
    "$source_root/http/http.go" \
    "$source_root/internal/servername/servername.go"
