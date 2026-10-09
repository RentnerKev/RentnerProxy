import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
