// oxlint-disable no-await-in-loop -- stream draining and ordered Docker cleanup are sequential.
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SMOKE_RUN_LABEL, smokeRunScope } from './smoke-resources'
import { CERTIFICATE_ERROR_CODES } from '../web/src/config/certificates.config'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
export const smokeSuites = {
    proxy: {
        label: 'Proxy runtime',
        script: 'proxy:smoke',
        source: 'proxy-smoke.ts',
        completion: /^Real Caddy proxy integration: (\d+) checks passed\.$/u,
    },
    certificates: {
        label: 'Certificates / ACME',
        script: 'certificates:smoke',
        source: 'certificate-smoke.ts',
        completion: /^Certificate HTTPS\/ACME integration: (\d+) checks passed\.$/u,
    },
    'upstream-tls': {
        label: 'Upstream TLS',
        script: 'upstream-tls:smoke',
        source: 'upstream-tls-smoke.ts',
        completion: /^Real HTTPS upstream TLS integration: (\d+) checks passed\.$/u,
    },
    production: {
        label: 'Production appliance',
        script: 'production:smoke',
        source: 'appliance-compose-smoke.ts',
        completion: /^Appliance Compose smoke passed: (\d+) assertions$/u,
    },
} as const
type Suite = keyof typeof smokeSuites
type Result = { status: 'PASS' | 'FAIL'; checks: number; seconds: number }

// Raw child output can contain assertion operands, generated credentials or PEM material.
// Publish only counts, fixed diagnostic categories and locations in the selected smoke source.
// Raw output is neither written to disk nor uploaded as an artifact.
export function smokeProgress(suite: Suite) {
    let checks = 0
    let reportedChecks: number | undefined
    let diagnostic = ''
    const specification = smokeSuites[suite]
    return {
        consume(line: string): string | undefined {
            if (line.startsWith('PASS ')) {
                checks += 1
                return specification.label + ': check ' + checks + ' passed'
            }
            const completion = specification.completion.exec(line)
            if (completion) reportedChecks = Number(completion[1])
            const certificateFailure = CERTIFICATE_ERROR_CODES.find((code) =>
                line.endsWith('Certificate operation failed: ' + code),
            )
            if (suite === 'certificates' && certificateFailure) {
                diagnostic = 'Certificate operation failed: ' + certificateFailure
            }
            if (/\b[Ss]moke command failed: docker (build|compose|run|exec)\b/u.test(line)) {
                const operation = /docker (build|compose|run|exec)\b/u.exec(line)?.[1]
                diagnostic = 'Docker ' + operation + ' failed'
            } else if (/\b[Tt]imed out waiting for /u.test(line)) {
                diagnostic = 'Readiness polling timed out'
            } else if (line.includes('AssertionError')) {
                diagnostic = 'Smoke assertion failed'
            }
            const location = line.match(/(?:scripts[/\\])([a-z-]+\.ts):(\d+):(\d+)/u)
            if (location?.[1] === specification.source) {
                diagnostic = (
                    diagnostic +
                    ' at scripts/' +
                    location[1] +
                    ':' +
                    location[2] +
                    ':' +
                    location[3]
                ).slice(0, 300)
            }
            return undefined
        },
        result(exitCode: number) {
            return {
                checks,
                passed: exitCode === 0 && checks > 0 && reportedChecks === checks,
                diagnostic,
            }
        },
    }
}

function temporaryRoot(scope: string): string {
    // Only this computed child directory is removed, never RUNNER_TEMP itself.
    return resolve(process.env.RUNNER_TEMP ?? tmpdir(), 'rentnerproxy-smokes-' + scope)
}

async function runSuite(suite: Suite, root: string): Promise<number> {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const fixtures = join(root, 'fixtures')
    await mkdir(fixtures, { recursive: true, mode: 0o700 })
    const progress = smokeProgress(suite)
    const started = Date.now()
    console.log('Starting ' + smokeSuites[suite].label)
    const child = Bun.spawn({
        cmd: [process.execPath, '--no-orphans', 'run', smokeSuites[suite].script],
        cwd: repositoryRoot,
        env: { ...process.env, TMPDIR: fixtures, TEMP: fixtures, TMP: fixtures, NO_COLOR: '1' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
    })
    async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
        let pending = ''
        let oversized = false
        const decoder = new TextDecoder()
        for await (const bytes of stream) {
            const chunk = decoder.decode(bytes, { stream: true })
            for (const piece of chunk.split(/(?<=\n)/u)) {
                if (!oversized) pending += piece
                if (pending.length > 4096) {
                    pending = ''
                    oversized = true
                }
                if (piece.endsWith('\n')) {
                    if (!oversized) {
                        const message = progress.consume(pending.trimEnd())
                        if (message) console.log(message)
                    }
                    pending = ''
                    oversized = false
                }
            }
        }
        if (pending && !oversized) {
            const message = progress.consume(pending.trimEnd())
            if (message) console.log(message)
        }
    }
    const [exitCode] = await Promise.all([child.exited, drain(child.stdout), drain(child.stderr)])
    const outcome = progress.result(exitCode)
    const result: Result = {
        status: outcome.passed ? 'PASS' : 'FAIL',
        checks: outcome.checks,
        seconds: Math.round((Date.now() - started) / 1000),
    }
    await writeFile(join(root, suite + '.json'), JSON.stringify(result), { mode: 0o600 })
    console.log(
        result.status +
            ' ' +
            smokeSuites[suite].label +
            ': ' +
            result.checks +
            ' checks in ' +
            result.seconds +
            's (exit ' +
            exitCode +
            ')',
    )
    if (!outcome.passed) console.error(outcome.diagnostic || 'Smoke did not complete successfully')
    return outcome.passed ? 0 : 1
}

async function docker(args: string[]): Promise<string> {
    const child = Bun.spawn({ cmd: ['docker', ...args], stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 60_000)
    try {
        const [exitCode, output] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        if (exitCode !== 0) throw new Error('Scoped Docker cleanup failed')
        return output.trim()
    } finally {
        clearTimeout(timer)
    }
}

async function cleanup(scope: string, root: string): Promise<void> {
    const rows = ['| Smoke | Result | Checks | Duration |', '| --- | --- | ---: | ---: |']
    for (const suite of Object.keys(smokeSuites) as Suite[]) {
        let result: Result | undefined
        try {
            const value: unknown = JSON.parse(await readFile(join(root, suite + '.json'), 'utf8'))
            if (
                value &&
                typeof value === 'object' &&
                'status' in value &&
                'checks' in value &&
                'seconds' in value &&
                (value.status === 'PASS' || value.status === 'FAIL') &&
                Number.isSafeInteger(value.checks) &&
                Number.isSafeInteger(value.seconds)
            ) {
                result = value as Result
            }
        } catch {
            // A skipped or cancelled step may not have written a result.
        }
        rows.push(
            '| ' +
                smokeSuites[suite].label +
                ' | ' +
                (result?.status ?? 'NOT COMPLETED') +
                ' | ' +
                (result?.checks ?? '-') +
                ' | ' +
                (result ? result.seconds + 's' : '-') +
                ' |',
        )
    }
    const filter = 'label=' + SMOKE_RUN_LABEL + '=' + scope
    let failed = false
    // Remove containers before their persistent state and networks. Every query has the exact
    // run/attempt label, including temporary OpenSSL and Compose restore helper containers.
    for (const [list, remove] of [
        [
            ['container', 'ls', '--all', '--quiet'],
            ['container', 'rm', '--force', '--volumes'],
        ],
        [
            ['volume', 'ls', '--quiet'],
            ['volume', 'rm'],
        ],
        [
            ['network', 'ls', '--quiet'],
            ['network', 'rm'],
        ],
        [
            ['image', 'ls', '--quiet'],
            ['image', 'rm', '--force'],
        ],
    ] as const) {
        try {
            const resources = (await docker([...list, '--filter', filter]))
                .split(/\s+/u)
                .filter(Boolean)
            for (const resource of new Set(resources)) {
                if (!/^(?:sha256:)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(resource)) {
                    throw new Error('Invalid Docker resource identifier')
                }
                await docker([...remove, resource])
            }
            if (await docker([...list, '--filter', filter]))
                throw new Error('Owned resources remain')
        } catch {
            failed = true
            console.error("Cleanup failed for this run's Docker " + list[0] + ' resources')
        }
    }
    await rm(root, { recursive: true, force: true })
    const summary = rows.join('\n') + '\n\nScoped cleanup: ' + (failed ? 'FAIL' : 'PASS') + '\n'
    console.log(summary)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
    if (failed) throw new Error('Owned smoke resources could not all be removed')
}

if (import.meta.main) {
    try {
        const scope = smokeRunScope()
        if (!scope) throw new Error('RENTNERPROXY_SMOKE_RUN is required for CI smoke isolation')
        const suite = process.argv[2]
        const root = temporaryRoot(scope)
        if (suite === 'cleanup') await cleanup(scope, root)
        else if (suite && Object.hasOwn(smokeSuites, suite)) {
            process.exitCode = await runSuite(suite as Suite, root)
        } else throw new Error('Unknown smoke suite')
    } catch {
        console.error('Production smoke runner failed; inspect the completed steps above')
        process.exitCode = 1
    }
}
