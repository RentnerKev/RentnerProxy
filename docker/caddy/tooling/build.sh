#!/bin/sh
set -eu

test "$(go env GOVERSION)" = go1.27.2
cd /opt/rentnerproxy-responsecache
GODEBUG="${GODEBUG:+$GODEBUG,}http2client=0" go mod download
go mod verify
go test -mod=readonly ./...
cd /tmp/rentnerproxy-caddy
GODEBUG="${GODEBUG:+$GODEBUG,}http2client=0" xcaddy build "${CADDY_VERSION:?Caddy builder must specify CADDY_VERSION}" --output /usr/bin/caddy \
        --with github.com/hslatman/caddy-crowdsec-bouncer/http@${CADDY_CROWDSEC_BOUNCER_COMMIT} \
        --with github.com/RentnerKev/RentnerProxy/core/caddy-modules/responsecache=/opt/rentnerproxy-responsecache \
        --replace github.com/mholt/caddy-l4=github.com/mholt/caddy-l4@${CADDY_LAYER4_VERSION:?Caddy builder must pin the upstream Layer 4 module} \
        --replace github.com/crowdsecurity/crowdsec=github.com/crowdsecurity/crowdsec@v1.8.1 \
        --replace golang.org/x/net=golang.org/x/net@v0.61.0 \
        --replace golang.org/x/crypto=golang.org/x/crypto@v0.58.0 \
        --replace golang.org/x/sys=golang.org/x/sys@v0.49.0 \
        --replace golang.org/x/term=golang.org/x/term@v0.47.0 \
        --replace golang.org/x/text=golang.org/x/text@v0.43.0
go version -m /usr/bin/caddy > /tmp/caddy-buildinfo.txt
/bin/sh /tmp/verify-caddy-buildinfo.sh /tmp/caddy-buildinfo.txt
caddy_version="$(/usr/bin/caddy version)"
printf '%s\n' "$caddy_version"
test "${caddy_version%% *}" = "$CADDY_VERSION"
/usr/bin/caddy list-modules | grep -Fx crowdsec
/usr/bin/caddy list-modules | grep -Fx http.handlers.crowdsec
/usr/bin/caddy list-modules | grep -Fx http.handlers.rentnerproxy_response_cache
