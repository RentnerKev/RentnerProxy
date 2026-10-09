#!/usr/bin/env bash
set -Eeuo pipefail
directory="$RUNNER_TEMP/dependency-tools"
mkdir -p "$directory"
curl --fail --location --proto '=https' --tlsv1.2 \
    https://github.com/anchore/grype/releases/download/v0.120.1/grype_0.120.1_linux_amd64.tar.gz \
    --output "$directory/grype.tar.gz"
printf '%s  %s\n' 0a9ee97ef5ae2ee953b0a80098105052e846cdbe319a57d808b519c33cd1343d "$directory/grype.tar.gz" | sha256sum --check --strict
tar -xzf "$directory/grype.tar.gz" -C "$directory" grype
curl --fail --location --proto '=https' --tlsv1.2 \
    https://github.com/anchore/syft/releases/download/v1.54.1/syft_1.54.1_linux_amd64.tar.gz \
    --output "$directory/syft.tar.gz"
printf '%s  %s\n' c069905b391cc4c20a5ba65ad5c10be2a7ba074f8ea6ad203e24d14e303dad47 "$directory/syft.tar.gz" | sha256sum --check --strict
tar -xzf "$directory/syft.tar.gz" -C "$directory" syft
curl --fail --location --proto '=https' --tlsv1.2 \
    https://go.dev/dl/go1.27.2.linux-amd64.tar.gz --output "$directory/go.tar.gz"
printf '%s  %s\n' ecbadb99091a3f46e31f5f934b068b1864eafa7995211b39eaddf76996045fe5 "$directory/go.tar.gz" | sha256sum --check --strict
tar -xzf "$directory/go.tar.gz" -C "$directory"
export PATH="$directory/go/bin:$PATH"
# Go's public checksum database authenticates the pinned module and dependencies.
GOBIN="$directory" GOSUMDB=sum.golang.org GOPROXY=https://proxy.golang.org GOTOOLCHAIN=local \
    go install golang.org/x/vuln/cmd/govulncheck@v1.8.0
printf '%s\n' "$directory" "$directory/go/bin" >> "$GITHUB_PATH"
sudo apt-get update
sudo apt-get install --yes --no-install-recommends skopeo
