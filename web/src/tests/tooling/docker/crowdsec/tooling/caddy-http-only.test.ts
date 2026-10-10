import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../../../../../..')
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'

async function transformedFixture(filter: string) {
    const parent = join(repositoryRoot, 'tmp')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'caddy-sdk-transform-'))
    const bin = join(directory, 'bin')
    await Promise.all(
        ['http', 'internal/servername', 'internal/bouncer', 'bin'].map((path) =>
            mkdir(join(directory, path), { recursive: true }),
        ),
    )
    await Promise.all([
        writeFile(join(bin, 'gofmt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }),
        writeFile(
            join(directory, 'http/http.go'),
            'package http\nimport "sdk" // always include AppSec module when HTTP is added\n',
        ),
        writeFile(
            join(directory, 'internal/servername/servername.go'),
            'package servername\nimport "fmt"\nimport l4 "github.com/mholt/caddy-l4/layer4"\n',
        ),
        writeFile(
            join(directory, 'internal/bouncer/live.go'),
            `package bouncer\nfunc filter(value string) {\n\toptions := DecisionsListOpts{\n\t\tIPEquals: ${filter},\n\t}\n\t_ = options\n}\n`,
        ),
    ])
    try {
        const child = Bun.spawn(
            [
                bash,
                '--noprofile',
                '--norc',
                '-c',
                'export PATH="$PWD/bin:/usr/bin:/bin"; chmod +x "$PWD/bin"/*; exec bash "$FIXTURE_SCRIPT" .',
            ],
            {
                cwd: directory,
                env: {
                    ...process.env,
                    FIXTURE_SCRIPT: join(
                        repositoryRoot,
                        'docker/crowdsec/tooling/caddy-http-only.sh',
                    ).replaceAll('\\', '/'),
                },
                stdin: 'ignore',
                stdout: 'ignore',
                stderr: 'ignore',
            },
        )
        const exitCode = await child.exited
        const [live, http] = await Promise.all([
            readFile(join(directory, 'internal/bouncer/live.go'), 'utf8'),
            readFile(join(directory, 'http/http.go'), 'utf8'),
        ])
        return { exitCode, live, http }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

describe('HTTP-only bouncer SDK compatibility', () => {
    test('adapts the original pointer filter to the same exact IP string and removes AppSec', async () => {
        const result = await transformedFixture('&value')
        expect(result.exitCode).toBe(0)
        expect(result.live).toContain('IPEquals: value,')
        expect(result.live).not.toContain('&value')
        expect(result.http).not.toContain('always include AppSec')
    })

    test('fails before transforming an unexpected upstream filter', async () => {
        const result = await transformedFixture('otherValue')
        expect(result.exitCode).not.toBe(0)
        expect(result.live).toContain('IPEquals: otherValue,')
        expect(result.http).toContain('always include AppSec')
    })
})
