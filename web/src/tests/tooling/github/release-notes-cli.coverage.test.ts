import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

test('release notes CLI writes reviewed outputs from an offline API and rejects invalid metadata before publishing', async () => {
    const repository = resolve(import.meta.dir, '../../../../..')
    const parent = join(repository, 'tmp/release-notes-cli-tests')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'run-'))
    if (dirname(directory) !== parent) throw new Error('Unexpected release fixture directory.')
    const output = join(directory, 'release')
    const preload = join(directory, 'offline-api.ts')
    const config = join(directory, 'config.json')
    const environment = {
        ...process.env,
        GITHUB_REPOSITORY: 'RentnerKev/RentnerProxy',
        GITHUB_TOKEN: 'synthetic-offline-token',
        RELEASE_TAG: 'v1.2.3',
        RELEASE_PUBLISHED_AT: '2026-10-29T00:00:00.000Z',
        RELEASE_PRERELEASE: 'false',
        RELEASE_CHANNEL: 'stable',
        RELEASE_IMAGE: 'ghcr.io/rentnerkev/rentnerproxy',
        RELEASE_ID: '123',
    }
    async function run(
        changes: Record<string, string> = {},
        args = ['--config', config, '--output-dir', output],
    ) {
        const child = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                '--preload',
                preload,
                join(repository, '.github/scripts/release/generate-release-notes.ts'),
                ...args,
            ],
            {
                cwd: repository,
                env: { ...environment, ...changes },
                stdin: 'ignore',
                stdout: 'pipe',
                stderr: 'pipe',
            },
        )
        const [stdout, stderr, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(stdout + stderr).not.toContain('synthetic-offline-token')
        return { stdout, stderr, code }
    }
    try {
        await writeFile(
            preload,
            'globalThis.fetch = async (input) => { const url = new URL(String(input)); if (url.origin !== "https://api.github.com" || !/^\\/repos\\/RentnerKev\\/RentnerProxy\\/(releases|milestones|issues)$/.test(url.pathname)) throw new Error("Unexpected API request"); return Response.json([]) }',
        )
        await writeFile(
            config,
            JSON.stringify({
                excludedLabels: [],
                highlightLabels: [],
                categories: [{ title: 'Changes', labels: [] }],
            }),
        )
        const successful = await run()
        expect(successful).toMatchObject({ code: 0, stderr: '' })
        expect(successful.stdout).toContain('Generated release notes from 0 eligible issue(s).')
        expect(successful.stdout).toContain('Previous release: none (initial release).')
        expect(await readFile(join(output, 'release-body.md'), 'utf8')).toContain(
            'ghcr.io/rentnerkev/rentnerproxy',
        )
        expect(await readFile(join(output, 'RentnerProxy-v1.2.3-CHANGELOG.md'), 'utf8')).toContain(
            'v1.2.3',
        )
        for (const [changes, expected] of [
            [{ GITHUB_REPOSITORY: '' }, 'GITHUB_REPOSITORY is required'],
            [{ RELEASE_PRERELEASE: 'yes' }, 'RELEASE_PRERELEASE must be true or false'],
            [{ RELEASE_CHANNEL: 'nightly' }, 'RELEASE_CHANNEL must be alpha, beta, or stable'],
            [{ RELEASE_ID: '-1' }, 'RELEASE_ID must be a positive integer'],
        ] as const) {
            // eslint-disable-next-line no-await-in-loop -- one CLI process at a time verifies a shared isolated output directory
            const invalid = await run(changes)
            expect(invalid.code).toBe(1)
            expect(invalid.stderr).toContain(expected)
        }
        const missingOption = await run({}, ['--config', '--output-dir', output])
        expect(missingOption.code).toBe(1)
        expect(missingOption.stderr).toContain('--config requires a value')
        expect(await readFile(join(output, 'RentnerProxy-v1.2.3-CHANGELOG.md'), 'utf8')).toContain(
            'v1.2.3',
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
