import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import {
    AdvisoryPolicyError,
    evaluateBunAudit,
} from '../../../../../.github/scripts/security/dependency-policy.ts'

const script = resolve(
    import.meta.dir,
    '../../../../../.github/scripts/security/dependency-policy.ts',
)
const advisory = {
    id: 1234567,
    url: 'https://example.org/advisories/fixture',
    title: 'Synthetic dependency advisory',
    severity: 'high',
    vulnerable_versions: '<1.0.1',
}
const blocked = { 'fixture-package': [advisory] }
const prefix = 'rentnerproxy-bun-audit-'

describe('Bun audit evidence', () => {
    test('complete reports preserve the moderate severity threshold', () => {
        expect(() => evaluateBunAudit({}, 0, '')).not.toThrow()
        for (const severity of ['info', 'low'])
            expect(() =>
                evaluateBunAudit({ 'fixture-package': [{ ...advisory, severity }] }, 0, ''),
            ).not.toThrow()
        for (const severity of ['moderate', 'high', 'critical'])
            expect(() =>
                evaluateBunAudit({ 'fixture-package': [{ ...advisory, severity }] }, 1, ''),
            ).toThrow(AdvisoryPolicyError)
    })

    test('foreign exits, transport diagnostics and inconsistent reports are incomplete', () => {
        for (const [report, status, diagnostics] of [
            [blocked, 3, ''],
            [{}, 3, ''],
            [blocked, 0, ''],
            [{}, 1, ''],
            [blocked, 1, 'error: audit request failed: ConnectionRefused'],
            [blocked, 1, 'warning: scoped registry could not be audited'],
            [{}, 0, 'warning: packages skipped'],
        ] as const) {
            expect(() => evaluateBunAudit(report, status, diagnostics)).toThrow(Error)
            expect(() => evaluateBunAudit(report, status, diagnostics)).not.toThrow(
                AdvisoryPolicyError,
            )
        }
    })

    test('all advisory entries are validated before a blocked verdict', () => {
        for (const report of [
            null,
            [],
            { error: 'Proxy unavailable' },
            { 'fixture-package': [] },
            { 'fixture-package': [null] },
            { 'fixture-package': [advisory, {}] },
            { 'fixture-package': [{ ...advisory, id: 0 }] },
            { 'fixture-package': [{ ...advisory, title: undefined }] },
            { 'fixture-package': [{ ...advisory, vulnerable_versions: undefined }] },
            { 'fixture-package': [{ ...advisory, severity: 'unknown' }] },
            { 'fixture-package': [{ ...advisory, url: 'http://example.org/advisory' }] },
        ]) {
            expect(() => evaluateBunAudit(report, 1, '')).toThrow(Error)
            expect(() => evaluateBunAudit(report, 1, '')).not.toThrow(AdvisoryPolicyError)
        }
    })

    for (const fixture of [
        {
            name: 'a complete adverse registry response',
            body: JSON.stringify(blocked),
            http: 200,
            raw: 1,
            policy: 3,
        },
        { name: 'a complete clean registry response', body: '{}', http: 200, raw: 0, policy: 0 },
        {
            name: 'a below-threshold registry response',
            body: JSON.stringify({ 'fixture-package': [{ ...advisory, severity: 'low' }] }),
            http: 200,
            raw: 0,
            policy: 0,
        },
        {
            name: 'an informational registry response',
            body: JSON.stringify({ 'fixture-package': [{ ...advisory, severity: 'info' }] }),
            http: 200,
            raw: 1,
            policy: 1,
        },
        {
            name: 'an HTTP failure with advisory-shaped JSON',
            body: JSON.stringify(blocked),
            http: 502,
            raw: 1,
            policy: 1,
        },
        {
            name: 'an invalid proxy response',
            body: '<html>Proxy unavailable</html>',
            http: 200,
            raw: 1,
            policy: 1,
        },
        {
            name: 'a malformed advisory response',
            body: JSON.stringify({ 'fixture-package': [{}] }),
            http: 200,
            raw: 1,
            policy: 1,
        },
    ]) {
        test(`real CLI classifies ${fixture.name}`, async () => {
            const directory = await mkdtemp(join(tmpdir(), prefix))
            if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith(prefix))
                throw new Error('Unexpected audit fixture directory')
            const requests: string[] = []
            const server = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                async fetch(request) {
                    requests.push(new URL(request.url).pathname)
                    const body = Bun.gunzipSync(new Uint8Array(await request.arrayBuffer()))
                    expect(JSON.parse(new TextDecoder().decode(body)) as unknown).toEqual({
                        'fixture-package': ['1.0.0'],
                    })
                    return new Response(fixture.body, {
                        status: fixture.http,
                        headers: { 'Content-Type': 'application/json' },
                    })
                },
            })
            try {
                const packageJson = JSON.stringify({
                    name: 'audit-fixture',
                    dependencies: { 'fixture-package': '1.0.0' },
                })
                const lock = JSON.stringify({
                    lockfileVersion: 3,
                    configVersion: 1,
                    workspaces: {
                        '': { name: 'audit-fixture', dependencies: { 'fixture-package': '1.0.0' } },
                    },
                    packages: {
                        'fixture-package': [
                            'fixture-package@1.0.0',
                            '',
                            {},
                            `sha512-${Buffer.alloc(64).toString('base64')}`,
                        ],
                    },
                })
                await writeFile(join(directory, 'package.json'), packageJson)
                await writeFile(join(directory, 'bun.lock'), lock)
                await writeFile(
                    join(directory, 'bunfig.toml'),
                    `[install]\nregistry = "${server.url}"\n`,
                )
                const env = {
                    HOME: directory,
                    USERPROFILE: directory,
                    SystemRoot: process.env.SystemRoot ?? 'C:/Windows',
                    PATH: dirname(process.execPath),
                    TMP: directory,
                    TEMP: directory,
                }
                const audit = Bun.spawn(
                    [
                        process.execPath,
                        '--no-env-file',
                        'audit',
                        '--json',
                        '--audit-level=moderate',
                    ],
                    { cwd: directory, env, stdout: 'pipe', stderr: 'pipe' },
                )
                const [stdout, stderr, rawStatus] = await Promise.all([
                    new Response(audit.stdout).text(),
                    new Response(audit.stderr).text(),
                    audit.exited,
                ])
                expect(rawStatus).toBe(fixture.raw)
                expect(requests).toEqual(['/-/npm/v1/security/advisories/bulk'])
                if (fixture.policy === 3) expect(JSON.parse(stdout) as unknown).toEqual(blocked)
                const report = join(directory, 'audit.json')
                const diagnostics = join(directory, 'diagnostics.txt')
                await writeFile(report, stdout)
                await writeFile(diagnostics, stderr)
                const policy = Bun.spawn(
                    [
                        process.execPath,
                        '--no-env-file',
                        script,
                        'bun-audit',
                        report,
                        String(rawStatus),
                        diagnostics,
                    ],
                    { cwd: directory, env, stdout: 'pipe', stderr: 'pipe' },
                )
                await Promise.all([
                    new Response(policy.stdout).text(),
                    new Response(policy.stderr).text(),
                ])
                expect(await policy.exited).toBe(fixture.policy)
                if (fixture.policy === 3) {
                    const foreign = Bun.spawn(
                        [
                            process.execPath,
                            '--no-env-file',
                            script,
                            'bun-audit',
                            report,
                            '3',
                            diagnostics,
                        ],
                        { cwd: directory, env, stdout: 'pipe', stderr: 'pipe' },
                    )
                    await Promise.all([
                        new Response(foreign.stdout).text(),
                        new Response(foreign.stderr).text(),
                    ])
                    expect(await foreign.exited).toBe(1)
                }
                expect(await readFile(join(directory, 'bun.lock'), 'utf8')).toBe(lock)
                expect(await readFile(join(directory, 'package.json'), 'utf8')).toBe(packageJson)
            } finally {
                await server.stop(true)
                await rm(directory, { recursive: true, force: true })
            }
        })
    }
})
