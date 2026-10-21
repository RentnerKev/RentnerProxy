import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

function directoryArchive(): Buffer {
    const header = Buffer.alloc(512)
    header.write('./')
    header.write('0000700\0', 100)
    header.write('00000000000\0', 124)
    header.fill(32, 148, 156)
    header[156] = 53
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
    return Buffer.concat([header, Buffer.alloc(1024)])
}

async function backup(scenario: string) {
    const parent = join(root, 'tmp')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(join(parent, 'backup-readiness-'))
    const bin = join(directory, 'bin')
    const output = join(directory, 'backups')
    await mkdir(bin)
    const compose = join(directory, 'compose.yml')
    await writeFile(compose, 'fixture only; docker is replaced')
    await writeFile(join(directory, 'archive.tar'), directoryArchive())
    await writeFile(
        join(directory, 'clock.ts'),
        `let calls = 0; Object.defineProperty(performance, 'now', { value: () => calls++ < 3 ? 0 : 200_000 });`,
    )
    const fake = join(bin, 'docker')
    await writeFile(
        fake,
        `#!/usr/bin/env -S bun --no-env-file
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
const command = process.argv.slice(2).join(' ')
const directory = process.env.FIXTURE_DIRECTORY
const scenario = process.env.FIXTURE_SCENARIO
appendFileSync(directory + '/calls', command + '\\n')
const imageId = 'sha256:' + 'a'.repeat(64)
if (command.includes('config --format=json')) {
    console.log(JSON.stringify({ services: { rentnerproxy: { image: 'fixture-image', environment: { RENTNERPROXY_PUBLIC_ORIGIN: 'https://proxy.test' } } } }))
} else if (command.startsWith('image inspect ')) {
    console.log(JSON.stringify({ Id: imageId, Config: {} }))
} else if (command.includes('ps --all --quiet')) {
    console.log('fixture-container')
} else if (command.startsWith('inspect ')) {
    console.log(imageId)
} else if (command.includes('ps --status running --quiet')) {
    if (scenario !== 'stopped') console.log('fixture-container')
} else if (command.includes('stop --timeout 30')) {
    // No real container is contacted.
} else if (command.includes('start rentnerproxy')) {
    if (scenario === 'restart-failure' || scenario === 'early-failure') process.exit(1)
} else if (command.includes('exec --no-TTY rentnerproxy bun')) {
    if (scenario === 'readiness-failure') process.exit(1)
    const marker = directory + '/health-probed'
    if (scenario === 'warming' && !existsSync(marker)) { writeFileSync(marker, '1'); process.exit(1) }
} else if (command.includes('export-app-key')) {
    if (scenario === 'early-failure') process.exit(1)
    process.stdout.write('A'.repeat(43) + '=\\n')
} else if (command.includes('pg_dump')) {
    process.stdout.write('fixture-dump')
} else if (command.includes('--entrypoint tar')) {
    process.stdout.write(readFileSync(directory + '/archive.tar'))
} else {
    process.exit(91)
}
`,
    )
    await chmod(fake, 0o755)
    try {
        const child = Bun.spawn({
            cmd: [
                process.execPath,
                '--no-env-file',
                ...(scenario === 'readiness-failure'
                    ? ['--preload', join(directory, 'clock.ts')]
                    : []),
                join(root, 'scripts/production-backup.ts'),
                '--output',
                output,
            ],
            cwd: root,
            env: {
                ...process.env,
                PATH: bin + ':' + process.env.PATH,
                FIXTURE_DIRECTORY: directory,
                FIXTURE_SCENARIO: scenario,
                RENTNERPROXY_COMPOSE_FILE: compose,
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [exit, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        const calls = (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n')
        const backups = await readdir(output)
        await Promise.all(
            backups.map(async (name) => {
                const metadata = JSON.parse(
                    await readFile(join(output, name, 'metadata.json'), 'utf8'),
                )
                expect(metadata.format).toBe('rentnerproxy-production-backup')
                expect(metadata.version).toBe(4)
            }),
        )
        return { exit, stdout, stderr, calls, backups }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

describe.skipIf(process.platform === 'win32')(
    'production backup CLI with isolated Docker fixtures',
    () => {
        test('waits for real readiness after restarting an originally running appliance', async () => {
            const result = await backup('warming')
            expect(result.exit).toBe(0)
            expect(result.backups).toHaveLength(1)
            const restart = result.calls.findIndex((call) => call.endsWith('start rentnerproxy'))
            const probes = result.calls.filter((call) => call.includes('healthcheck.ts'))
            expect(probes).toHaveLength(2)
            expect(result.calls.indexOf(probes[0]!)).toBeGreaterThan(restart)
            expect(result.stdout).toContain('Production backup created:')
        })

        test('keeps an initialized stopped appliance stopped without requiring application readiness', async () => {
            const result = await backup('stopped')
            expect(result.exit).toBe(0)
            expect(result.backups).toHaveLength(1)
            expect(
                result.calls.some(
                    (call) =>
                        call.includes('start rentnerproxy') ||
                        call.includes('healthcheck.ts') ||
                        call.includes('stop --timeout'),
                ),
            ).toBe(false)
        })

        test.each(['restart-failure', 'readiness-failure'])(
            'retains the published backup and reports failure for %s',
            async (scenario) => {
                const result = await backup(scenario)
                expect(result.exit).toBe(1)
                expect(result.backups).toHaveLength(1)
                expect(result.stderr).toContain('Completed backup retained:')
                expect(result.stderr).toContain('could not be restarted or did not become ready')
            },
        )

        test('does not claim a captured backup when export and restart both fail', async () => {
            const result = await backup('early-failure')
            expect(result.exit).toBe(1)
            expect(result.backups).toHaveLength(0)
            expect(result.stderr).toContain('Backup did not complete.')
            expect(result.stderr).not.toContain('Completed backup retained:')
            expect(result.stderr).not.toContain('Backup captured')
            expect(result.stdout).not.toContain('Production backup created:')
        })
    },
)
