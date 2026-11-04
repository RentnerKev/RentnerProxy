import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

describe('upstream Caddy binary security metadata', () => {
    test('source preparation verifies the reviewed backport and preserves dependency manifests', async () => {
        const root = resolve(import.meta.dir, '../../../../..')
        const [script, patch] = await Promise.all([
            readFile(join(root, 'docker/caddy/tooling/prepare-source.sh'), 'utf8'),
            readFile(join(root, 'docker/caddy/patches/runtime-reload.patch')),
        ])
        expect(script).toContain(createHash('sha256').update(patch).digest('hex'))
        const changedPaths = patch
            .toString()
            .split('\n')
            .filter((line) => line.startsWith('diff --git '))
        expect(changedPaths.length).toBeGreaterThan(0)
        expect(changedPaths.some((line) => /\/(?:go\.mod|go\.sum)(?: |$)/u.test(line))).toBe(false)
        expect(script).toContain('cmp "$source/go.mod" go.mod')
        expect(script).toContain('cmp "$source/go.sum" go.sum')
    })

    test.skipIf(process.platform === 'win32')(
        'unreviewed Caddy versions are rejected before any tools or source writes',
        () => {
            const script = resolve(
                import.meta.dir,
                '../../../../../docker/caddy/tooling/prepare-source.sh',
            )
            const result = Bun.spawnSync(['/bin/sh', script], {
                env: { PATH: '/no-build-tools', CADDY_VERSION: 'v2.11.8' },
                stdout: 'pipe',
                stderr: 'pipe',
            })
            expect(result.exitCode).toBe(2)
            expect(result.stderr.toString()).toContain('requires review for this version')
        },
    )

    test('both images use the same Caddy build while retaining pins, static ABI and licenses', async () => {
        const root = resolve(import.meta.dir, '../../../../..')
        const shared = await readFile(join(root, 'docker/caddy/tooling/build.sh'), 'utf8')
        const images = await Promise.all(
            ['production', 'proxy-runtime'].map((image) =>
                readFile(join(root, 'docker', image, 'Dockerfile'), 'utf8'),
            ),
        )
        const caddyBuilders = images.map(
            (image) =>
                image.match(
                    /^FROM (mirror\.gcr\.io\/library\/caddy:\d+\.\d+\.\d+-builder@sha256:[a-f0-9]{64}) AS caddy-build$/mu,
                )?.[1],
        )
        expect(caddyBuilders[0]).toBeDefined()
        expect(caddyBuilders[1]).toBe(caddyBuilders[0])
        for (const image of images) {
            expect(image).toContain('COPY docker/caddy/tooling/build.sh /tmp/build-caddy.sh')
            expect(image).toContain(
                'COPY docker/caddy/tooling/prepare-source.sh /tmp/prepare-caddy-source.sh',
            )
            expect(image).toContain('COPY docker/caddy/patches/ /opt/rentnerproxy-caddy-patches/')
            expect(image).toContain(
                'COPY docker/tooling/buildinfo/verify.go /tmp/verify-buildinfo.go',
            )
            expect(image).toContain(
                'COPY core/caddy-modules/responsecache/ /opt/rentnerproxy-responsecache/',
            )
            expect(image).toContain('http.handlers.rentnerproxy_response_cache')
            const runInstructions = image.replace(/\\\r?\n[ \t]*/gu, ' ').match(/^RUN .+$/gmu)
            expect(
                runInstructions?.join('\n').match(/\/bin\/sh \/tmp\/build-caddy\.sh(?=\s|$)/gu),
            ).toHaveLength(1)
            expect(image).not.toContain('xcaddy build')
            expect(image).toContain('ENV GOTOOLCHAIN=local CGO_ENABLED=0')
            expect(image).toContain(
                'ARG CADDY_CROWDSEC_BOUNCER_VERSION=v0.14.2-0.20261030164527-4a6ce1d3094d',
            )
            expect(image).toContain('ARG CADDY_LAYER4_VERSION=v0.1.3-0.20261029145729-f607ccea1b7d')
            expect(image).toContain('COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy')
            expect(image).toContain(
                'docker/licenses/CaddyCrowdSecBouncer-NOTICE /usr/share/licenses/caddy-crowdsec-bouncer/NOTICE',
            )
            expect(image).toContain(
                'golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb',
            )
        }
        for (const contract of [
            'test "$(go env GOVERSION)" = go1.27.3',
            '--with github.com/hslatman/caddy-crowdsec-bouncer/http@${CADDY_CROWDSEC_BOUNCER_VERSION:?Caddy builder must pin the upstream CrowdSec module}',
            'go mod verify',
            '/bin/sh /tmp/prepare-caddy-source.sh',
            'go mod edit -replace github.com/caddyserver/caddy/v2=/opt/rentnerproxy-caddy-source',
            '--replace github.com/caddyserver/caddy/v2=/opt/rentnerproxy-caddy-source',
            'go test -mod=readonly ./...',
            '--with github.com/RentnerKev/RentnerProxy/core/caddy-modules/responsecache=/opt/rentnerproxy-responsecache',
            '--replace github.com/mholt/caddy-l4=github.com/mholt/caddy-l4@${CADDY_LAYER4_VERSION:?Caddy builder must pin the upstream Layer 4 module}',
            '--replace github.com/crowdsecurity/crowdsec=github.com/crowdsecurity/crowdsec@v1.8.2',
            '--replace golang.org/x/net=golang.org/x/net@v0.62.0',
            '--replace golang.org/x/crypto=golang.org/x/crypto@v0.58.0',
            '--replace golang.org/x/sys=golang.org/x/sys@v0.49.0',
            '--replace golang.org/x/term=golang.org/x/term@v0.47.0',
            '--replace golang.org/x/text=golang.org/x/text@v0.43.0',
            '/tmp/verify-buildinfo caddy /usr/bin/caddy',
            'test "${caddy_version%% *}" = "$CADDY_VERSION"',
        ])
            expect(shared).toContain(contract)
        expect(shared).toContain(
            'GOWORK=off go build -o /tmp/verify-buildinfo /tmp/verify-buildinfo.go',
        )
        expect(shared).toContain('go version -m /usr/bin/caddy > /tmp/caddy-buildinfo.txt')
        const contexts = await Promise.all(
            ['production', 'proxy-runtime'].map((image) =>
                readFile(join(root, 'docker', image, 'Dockerfile.dockerignore'), 'utf8'),
            ),
        )
        for (const context of contexts) {
            expect(context).toContain('!docker/tooling/')
            expect(context).toContain('!docker/tooling/buildinfo/')
            expect(context).toContain('!docker/tooling/buildinfo/**')
            expect(context).toMatch(/^!docker\/caddy\/tooling\/(?:prepare-source\.sh|\*\*)$/mu)
            expect(context).toContain('!docker/caddy/patches/')
            expect(context).toContain('!docker/caddy/patches/**')
        }
        expect(images[0]).toContain(
            'COPY docker/tooling/buildinfo/verify.go /opt/verify-buildinfo.go',
        )
        expect(shared.indexOf('go mod verify')).toBeLessThan(
            shared.indexOf('/bin/sh /tmp/prepare-caddy-source.sh'),
        )
        expect(shared.indexOf('/bin/sh /tmp/prepare-caddy-source.sh')).toBeLessThan(
            shared.indexOf('go mod edit -replace'),
        )
        expect(shared.indexOf('go mod edit -replace')).toBeLessThan(
            shared.indexOf('go test -mod=readonly'),
        )
        expect(shared).not.toContain('caddy-http-only')
        expect(shared).not.toContain('caddy-crowdsec-bouncer=/')
        expect(
            await readFile(join(root, 'docker/proxy-runtime/Dockerfile.dockerignore'), 'utf8'),
        ).toContain('!docker/caddy/tooling/build.sh')
    })
})
