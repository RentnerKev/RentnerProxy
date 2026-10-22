import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dir, '../../../../../docker/caddy/tooling/verify-buildinfo.sh')
const shell =
    Bun.which('sh') ??
    (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/sh.exe')
        ? 'C:/Program Files/Git/usr/bin/sh.exe'
        : null)
const validBuildinfo = `/usr/bin/caddy: go1.27.2
\tpath\tgithub.com/caddyserver/caddy/v2/cmd/caddy
\tdep\tgolang.org/x/net\tv0.59.0
\t=>\tgolang.org/x/net\tv0.61.0\th1:net
\tdep\tgithub.com/crowdsecurity/crowdsec\tv1.7.0
\t=>\tgithub.com/crowdsecurity/crowdsec\tv1.8.1\th1:crowdsec
\tbuild\tCGO_ENABLED=0
`

describe('patched Caddy binary security metadata', () => {
    test('both images use the same Caddy build while retaining pins, static ABI and licenses', async () => {
        const root = resolve(import.meta.dir, '../../../../..')
        const shared = await readFile(join(root, 'docker/caddy/tooling/build.sh'), 'utf8')
        const images = await Promise.all(
            ['production', 'proxy-runtime'].map((image) =>
                readFile(join(root, 'docker', image, 'Dockerfile'), 'utf8'),
            ),
        )
        for (const image of images) {
            expect(image).toContain('COPY docker/caddy/tooling/build.sh /tmp/build-caddy.sh')
            expect(image).toContain(
                'COPY core/caddy-modules/responsecache/ /opt/rentnerproxy-responsecache/',
            )
            expect(image).toContain('http.handlers.rentnerproxy_response_cache')
            expect(image.match(/RUN \/bin\/sh \/tmp\/build-caddy.sh/gu)).toHaveLength(1)
            expect(image).not.toContain('xcaddy build')
            expect(image).toContain('ENV GOTOOLCHAIN=local CGO_ENABLED=0')
            expect(image).toContain(
                'ARG CADDY_CROWDSEC_BOUNCER_COMMIT=6b35f6be25e457aa0b94e32c6ae519123e50e7b7',
            )
            expect(image).toContain(
                'ARG CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256=5ff0fd225d1d14cb29633516f0dfe084835dc99dc065ae11db852c661e9ced0d',
            )
            expect(image).toContain('COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy')
            expect(image).toContain(
                'docker/licenses/CaddyCrowdSecBouncer-NOTICE /usr/share/licenses/caddy-crowdsec-bouncer/NOTICE',
            )
            expect(image).toContain(
                'golang:1.27.2-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d',
            )
            expect(image).toContain(
                'caddy:2.11.7-builder@sha256:d842facfd63b960922e57444ff76fd8f0793a66dfdcf481af8026e1f4e6a39b4',
            )
        }
        for (const contract of [
            'test "$(go env GOVERSION)" = go1.27.2',
            '${CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256}  /tmp/caddy-crowdsec-bouncer.tar.gz',
            '/bin/sh /tmp/caddy-crowdsec-http-only.sh /tmp/caddy-crowdsec-bouncer',
            '--with github.com/hslatman/caddy-crowdsec-bouncer/http@${CADDY_CROWDSEC_BOUNCER_COMMIT}',
            'go mod verify',
            'go test -mod=readonly ./...',
            '--with github.com/RentnerKev/RentnerProxy/core/caddy-modules/responsecache=/opt/rentnerproxy-responsecache',
            '--replace github.com/crowdsecurity/crowdsec=github.com/crowdsecurity/crowdsec@v1.8.1',
            '--replace golang.org/x/net=golang.org/x/net@v0.61.0',
            '--replace golang.org/x/crypto=golang.org/x/crypto@v0.58.0',
            '--replace golang.org/x/sys=golang.org/x/sys@v0.49.0',
            '--replace golang.org/x/term=golang.org/x/term@v0.47.0',
            '--replace golang.org/x/text=golang.org/x/text@v0.43.0',
            '/bin/sh /tmp/verify-caddy-buildinfo.sh /tmp/caddy-buildinfo.txt',
            'test "${caddy_version%% *}" = "$CADDY_VERSION"',
            '! /usr/bin/caddy list-modules',
        ])
            expect(shared).toContain(contract)
        expect(shared.indexOf('sha256sum -c -')).toBeLessThan(shared.indexOf('tar -xzf'))
        expect(shared.indexOf('caddy-crowdsec-http-only.sh')).toBeLessThan(
            shared.indexOf('xcaddy build'),
        )
        expect(
            await readFile(join(root, 'docker/proxy-runtime/Dockerfile.dockerignore'), 'utf8'),
        ).toContain('!docker/caddy/tooling/build.sh')
    })
    test('checks the compiler and effective x/net version instead of the original module version', async () => {
        if (!shell) throw new Error('A POSIX shell is required to verify the Caddy build contract')
        const directory = await mkdtemp(join(tmpdir(), 'caddy-buildinfo-'))
        try {
            const variants = [
                [validBuildinfo, true],
                [
                    validBuildinfo.replace(
                        '\tdep\tgolang.org/x/net\tv0.59.0\n\t=>\tgolang.org/x/net\tv0.61.0',
                        '\tdep\tgolang.org/x/net\tv0.61.0',
                    ),
                    true,
                ],
                [validBuildinfo.replace('go1.27.2', 'go1.27.1'), false],
                [validBuildinfo.replace('v0.61.0', 'v0.59.0'), false],
                [
                    validBuildinfo
                        .replace('dep\tgolang.org/x/net\tv0.59.0', 'dep\tgolang.org/x/net\tv0.61.0')
                        .replace('=>\tgolang.org/x/net\tv0.61.0', '=>\tgolang.org/x/net\tv0.59.0'),
                    false,
                ],
                [validBuildinfo.replace('\t=>\tgolang.org/x/net\tv0.61.0\th1:net\n', ''), false],
                [validBuildinfo.replace('=>\tgolang.org/x/net', '=>\tlocal/fork'), false],
                [validBuildinfo.replace('CGO_ENABLED=0', 'CGO_ENABLED=1'), false],
                [validBuildinfo + '\tdep\tgolang.org/x/net\tv0.61.0\th1:duplicate\n', false],
                [
                    validBuildinfo.replace(
                        '\tdep\tgithub.com/crowdsecurity/crowdsec',
                        '\t=>\tgolang.org/x/net\tv0.61.0\n\tdep\tgithub.com/crowdsecurity/crowdsec',
                    ),
                    false,
                ],
                ['', false],
            ] as const
            const outcomes = await Promise.all(
                variants.map(async ([metadata, accepted], index) => {
                    const filename = join(directory, `buildinfo-${index}.txt`)
                    await writeFile(filename, metadata)
                    const child = Bun.spawn(
                        [
                            shell,
                            '-c',
                            'export PATH="/usr/bin:$PATH"; exec sh "$@"',
                            'caddy-build-test',
                            script,
                            filename,
                        ],
                        { stdout: 'pipe', stderr: 'pipe' },
                    )
                    const [stdout, stderr, exitCode] = await Promise.all([
                        new Response(child.stdout).text(),
                        new Response(child.stderr).text(),
                        child.exited,
                    ])
                    return { accepted, actual: exitCode === 0, stdout, stderr }
                }),
            )
            for (const outcome of outcomes) {
                expect(outcome.actual).toBe(outcome.accepted)
                expect(outcome.stdout).toBe('')
                expect(outcome.stderr).toBe('')
            }
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })
})
