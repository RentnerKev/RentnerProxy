#!/bin/sh
set -eu

test "$(go env GOVERSION)" = go1.27.2
wget -qO /tmp/caddy-crowdsec-bouncer.tar.gz \
        "https://codeload.github.com/hslatman/caddy-crowdsec-bouncer/tar.gz/${CADDY_CROWDSEC_BOUNCER_COMMIT}"
echo "${CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256}  /tmp/caddy-crowdsec-bouncer.tar.gz" | sha256sum -c -
tar -xzf /tmp/caddy-crowdsec-bouncer.tar.gz --strip-components=1
/bin/sh /tmp/caddy-crowdsec-http-only.sh /tmp/caddy-crowdsec-bouncer
xcaddy build "${CADDY_VERSION:?Caddy builder must specify CADDY_VERSION}" --output /usr/bin/caddy \
        --with github.com/hslatman/caddy-crowdsec-bouncer/http@${CADDY_CROWDSEC_BOUNCER_COMMIT} \
        --replace github.com/hslatman/caddy-crowdsec-bouncer=/tmp/caddy-crowdsec-bouncer \
        --replace github.com/crowdsecurity/crowdsec=github.com/crowdsecurity/crowdsec@v1.8.1 \
        --replace golang.org/x/net=golang.org/x/net@v0.61.0 \
        --replace golang.org/x/crypto=golang.org/x/crypto@v0.58.0 \
        --replace golang.org/x/sys=golang.org/x/sys@v0.49.0 \
        --replace golang.org/x/term=golang.org/x/term@v0.47.0 \
        --replace golang.org/x/text=golang.org/x/text@v0.43.0
go version -m /usr/bin/caddy > /tmp/caddy-buildinfo.txt
/bin/sh /tmp/verify-caddy-buildinfo.sh /tmp/caddy-buildinfo.txt
go version -m /usr/bin/caddy | grep -Eq '=>[[:space:]]+github\.com/crowdsecurity/crowdsec[[:space:]]+v1\.8\.1[[:space:]]'
caddy_version="$(/usr/bin/caddy version)"
printf '%s\n' "$caddy_version"
test "${caddy_version%% *}" = "$CADDY_VERSION"
/usr/bin/caddy list-modules | grep -Fx crowdsec
/usr/bin/caddy list-modules | grep -Fx http.handlers.crowdsec
! /usr/bin/caddy list-modules | grep -Eq '(^|\.)layer4($|\.)|^http\.handlers\.appsec$'
