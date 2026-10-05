import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '../../../../..')
const fixtureParent = join(repositoryRoot, 'tmp')
const ownedDirectories = new Set<string>()
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'

function shellPath(path: string): string {
    return relative(repositoryRoot, path).replaceAll('\\', '/')
}

async function fixture(): Promise<string> {
    await mkdir(fixtureParent, { recursive: true })
    const directory = await mkdtemp(join(fixtureParent, 'github-script-test-'))
    ownedDirectories.add(directory)
    return directory
}

async function runScript(script: string, environment: NodeJS.ProcessEnv) {
    const child = Bun.spawn(
        [bash, '--noprofile', '--norc', join(repositoryRoot, '.github/scripts', script)],
        {
            cwd: repositoryRoot,
            env: { ...process.env, ...environment },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    let timedOut = false
    const timer = setTimeout(() => {
        timedOut = true
        child.kill()
    }, 5_000)
    try {
        const [exitCode, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        if (timedOut) throw new Error('Automation fixture exceeded its five-second deadline')
        return { exitCode, stdout, stderr }
    } finally {
        clearTimeout(timer)
        if (child.exitCode === null) child.kill()
    }
}

afterEach(async () => {
    for (const directory of ownedDirectories) {
        const target = resolve(directory)
        if (
            dirname(target) !== fixtureParent ||
            !basename(target).startsWith('github-script-test-')
        ) {
            throw new Error('Refusing to remove a directory outside the owned fixture area')
        }
    }
    await Promise.all(
        [...ownedDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
    )
    ownedDirectories.clear()
})

describe('trusted PR title policy', () => {
    test.each([
        ['feat: add global search', true],
        ['fix(ui): Platzhalter lesbar machen', true],
        ['chore(deps)!: update supported versions', true],
        ['refactor(ci/github): organize automation', true],
        ['perf: reduce allocations', true],
        ['revert: restore the previous behavior', true],
        ['feature: add search', false],
        ['fix: ', false],
        ['fix:  leading whitespace', false],
        ['fix: title\nsecond line', false],
        ['fix: title\rinjected=value', false],
        ['fix: title\twith a tab', false],
        ['fix: title\u001bwith an escape', false],
        ['fix: title\u007fwith a control character', false],
    ])('validates %j', async (title, accepted) => {
        const result = await runScript('ci/validate-pr-title.sh', { EVENT_PR_TITLE: title })
        expect(result.exitCode === 0).toBe(accepted)
    })
})

describe('exact PR source proof', () => {
    test('writes only the validated PR number and tested SHA', async () => {
        const directory = await fixture()
        const sha = 'a'.repeat(40)
        const result = await runScript('ci/capture-preview-source.sh', {
            RUNNER_TEMP: shellPath(directory),
            PR_NUMBER: '42',
            TESTED_SHA: sha,
        })
        expect(result).toMatchObject({ exitCode: 0, stdout: '', stderr: '' })
        expect(await readFile(join(directory, 'pr-preview-source/pr-number.txt'), 'utf8')).toBe(
            '42\n',
        )
        expect(await readFile(join(directory, 'pr-preview-source/tested-sha.txt'), 'utf8')).toBe(
            `${sha}\n`,
        )
    })

    test.each([
        ['0', 'a'.repeat(40)],
        ['42\ninjected=value', 'a'.repeat(40)],
        ['42', 'a'.repeat(39)],
        ['42', 'a'.repeat(40) + '\ninjected=value'],
    ])('rejects invalid proof values %j', async (prNumber, sha) => {
        const directory = await fixture()
        const result = await runScript('ci/capture-preview-source.sh', {
            RUNNER_TEMP: shellPath(directory),
            PR_NUMBER: prNumber,
            TESTED_SHA: sha,
        })
        expect(result.exitCode).not.toBe(0)
        expect(await Bun.file(join(directory, 'pr-preview-source/tested-sha.txt')).exists()).toBe(
            false,
        )
    })
})

describe('bounded reliability selection', () => {
    test.each([
        ['push', 'all', 'long', '["current"]', 'short', true],
        ['pull_request', 'all', 'long', '["current"]', 'short', true],
        ['schedule', '', '', '["current","alpha.6"]', 'long', true],
        ['workflow_dispatch', 'alpha.6', 'short', '["alpha.6"]', 'short', true],
        ['workflow_dispatch', 'all', 'long', '["current","alpha.6"]', 'long', true],
        ['workflow_dispatch', 'unknown', 'short', '', '', false],
        ['workflow_dispatch', 'current', 'unknown', '', '', false],
        ['unknown', 'current', 'short', '', '', false],
    ])(
        'selects fixtures for %s / %s / %s',
        async (event, source, profile, sources, selectedProfile, accepted) => {
            const directory = await fixture()
            const output = join(directory, 'output.txt')
            await writeFile(output, '')
            const result = await runScript('ci/select-runtime-sources.sh', {
                EVENT_NAME: event,
                REQUESTED_SOURCE: source,
                REQUESTED_PROFILE: profile,
                GITHUB_OUTPUT: shellPath(output),
            })
            expect(result.exitCode === 0).toBe(accepted)
            expect(await readFile(output, 'utf8')).toBe(
                accepted ? `sources=${sources}\nprofile=${selectedProfile}\n` : '',
            )
        },
    )
})

describe('redacted commit scans', () => {
    test.each([
        ['pull_request', '-m ' + 'a'.repeat(40) + '..' + 'b'.repeat(40)],
        ['push', '-m ' + 'b'.repeat(40)],
        ['workflow_dispatch', '-m --all'],
    ])(
        'selects the correct range for %s without invoking a real scanner',
        async (event, logOptions) => {
            const directory = await fixture()
            const argumentsFile = join(directory, 'arguments.txt')
            await writeFile(
                join(directory, 'gitleaks'),
                '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$MOCK_GITLEAKS_ARGUMENTS"\n',
                { mode: 0o755 },
            )
            const result = await runScript('security/scan-commits.sh', {
                EVENT_NAME: event,
                RUNNER_TEMP: shellPath(directory),
                PR_BASE_SHA: 'a'.repeat(40),
                PR_HEAD_SHA: 'b'.repeat(40),
                PUSH_BEFORE_SHA: '0'.repeat(40),
                PUSH_AFTER_SHA: 'b'.repeat(40),
                MOCK_GITLEAKS_ARGUMENTS: shellPath(argumentsFile),
            })
            expect(result.exitCode).toBe(0)
            const argumentsList = (await readFile(argumentsFile, 'utf8')).trimEnd().split('\n')
            expect(argumentsList).toContain(`--log-opts=${logOptions}`)
            expect(argumentsList).toContain('--redact=100')
            expect(argumentsList).toContain('--no-color')
            expect(await readFile(join(directory, 'gitleaks.toml'), 'utf8')).toBe(
                '[extend]\nuseDefault = true\n',
            )
        },
    )
})
