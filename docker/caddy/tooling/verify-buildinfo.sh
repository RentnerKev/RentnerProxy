#!/bin/sh
set -eu

buildinfo=${1:?Usage: verify-buildinfo.sh BUILDINFO_FILE}
# Read the compiled artifact, including effective module replacements.
awk '
    NR == 1 { compiler = ($0 ~ /^.*: go1[.]27[.]2$/) }
    $1 == "dep" {
        net_module = ($2 == "golang.org/x/net")
        if (net_module) { net_count++; net_version = $3 }
        next
    }
    $1 == "=>" && net_module {
        net_replacements++
        if ($2 != "golang.org/x/net") invalid++
        net_version = $3
        next
    }
    { net_module = 0 }
    $1 == "build" && $2 == "CGO_ENABLED=0" { static_build++ }
    END {
        exit !(compiler && net_count == 1 && net_replacements <= 1 &&
            net_version == "v0.61.0" && invalid == 0 && static_build == 1)
    }
' "$buildinfo"
