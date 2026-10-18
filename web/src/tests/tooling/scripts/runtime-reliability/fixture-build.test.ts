import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { stageReliabilityFixtureSources } from '../../../../../../scripts/runtime-reliability/harness.ts'

async function buildFixture(directory: string): Promise<{ exitCode: number; stderr: string }> {
    const child = Bun.spawn({
        cmd: [
            process.execPath,
            '--no-env-file',
            'build',
            join(directory, 'scripts/runtime-reliability/fixture.ts'),
            '--target=bun',
            '--packages=external',
            // Historical application source is archived independently by the harness.
            // This regression exercises the complete current automation script graph.
            '--external=../../web/*',
            '--outfile=' + join(directory, 'fixture.js'),
        ],
        cwd: directory,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    return { exitCode, stderr }
}

test('stages and bundles the fixture automation with its shared request-context dependency', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-fixture-build-'))
    try {
        await stageReliabilityFixtureSources(directory)
        const helper = join(directory, 'scripts/lib/request-context.ts')
        expect(await readFile(helper, 'utf8')).toBe(
            await readFile(
                resolve(import.meta.dir, '../../../../../../scripts/lib/request-context.ts'),
                'utf8',
            ),
        )
        const complete = await buildFixture(directory)
        expect(complete).toEqual({ exitCode: 0, stderr: '' })
        await unlink(helper)
        const incomplete = await buildFixture(directory)
        expect(incomplete.exitCode).not.toBe(0)
        expect(incomplete.stderr).toContain('../lib/request-context.ts')
    } finally {
        expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
        expect(basename(directory)).toStartWith('rentnerproxy-fixture-build-')
        await rm(directory, { recursive: true, force: true })
    }
})
