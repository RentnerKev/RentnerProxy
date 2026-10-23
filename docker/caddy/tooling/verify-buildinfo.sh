#!/bin/sh
set -eu

buildinfo=${1:?Usage: verify-buildinfo.sh BUILDINFO_FILE}
# Inspect the artifact and effective dependency versions, including replacements.
# Only our own cache module may resolve to local source; foreign modules stay upstream.
awk '
    BEGIN {
        expected["golang.org/x/net"] = "v0.61.0"
        expected["github.com/crowdsecurity/crowdsec"] = "v1.8.1"
        expected["github.com/hslatman/caddy-crowdsec-bouncer"] = "v0.14.2-0.20260909201224-ffdcb7c6f861"
        expected["github.com/mholt/caddy-l4"] = "v0.1.3-0.20261023161224-4ad6aec1ccc6"
    }
    NR == 1 { compiler = ($0 ~ /^.*: go1[.]27[.]2$/) }
    $1 == "dep" {
        module = $2
        if (module in expected) { count[module]++; version[module] = $3 }
        next
    }
    $1 == "=>" {
        if (module == "github.com/RentnerKev/RentnerProxy/core/caddy-modules/responsecache") {
            if ($2 != "/opt/rentnerproxy-responsecache") invalid++
        } else if ($2 != module || $3 !~ /^v[0-9]/) invalid++
        if (module in expected) {
            replacements[module]++
            version[module] = $3
        }
        next
    }
    { module = "" }
    $1 == "build" && $2 == "CGO_ENABLED=0" { static_build++ }
    END {
        for (required in expected)
            if (count[required] != 1 || replacements[required] > 1 || version[required] != expected[required]) invalid++
        exit !(compiler && invalid == 0 && static_build == 1)
    }
' "$buildinfo"
