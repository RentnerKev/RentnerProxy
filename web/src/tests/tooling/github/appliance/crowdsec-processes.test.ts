import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    crowdSecEngineUidProbe,
    readCrowdSecEngineUids,
} from '../../../../../../.github/scripts/ci/appliance/crowdsec-processes.ts'

async function withProcFixture(run: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'crowdsec-proc-'))
    try {
        await run(directory)
    } finally {
        await rm(directory, { force: true, recursive: true })
    }
}

test('reads exact engine names and UIDs while ignoring processes that have disappeared', async () => {
    await withProcFixture(async (directory) => {
        await Promise.all(
            ['11', '12', '13', '14', 'self'].map((pid) => mkdir(join(directory, pid))),
        )
        await Promise.all([
            writeFile(
                join(directory, '11/status'),
                'Name:\tcrowdsec\nUid:\t10003\t10003\t10003\t10003\n',
            ),
            writeFile(join(directory, '12/status'), 'Name:\tcscli\nUid:\t0\t0\t0\t0\n'),
            writeFile(join(directory, '13/status'), 'Name:\tcrowdsec-other\nUid:\t0\t0\t0\t0\n'),
            writeFile(join(directory, 'self/status'), 'Name:\tcrowdsec\nUid:\t0\t0\t0\t0\n'),
        ])
        expect(await readCrowdSecEngineUids(directory)).toEqual(['10003'])
        const child = Bun.spawn(
            [process.execPath, '--no-env-file', '-e', crowdSecEngineUidProbe(directory)],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [exit, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: '["10003"]', stderr: '' })
    })
})

test('disappearing processes produce an empty JSON result rather than diagnostic UID rows', async () => {
    await withProcFixture(async (directory) => {
        await mkdir(join(directory, '99'))
        const child = Bun.spawn(
            [process.execPath, '--no-env-file', '-e', crowdSecEngineUidProbe(directory)],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [exit, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        expect({ exit, stdout, stderr }).toEqual({ exit: 0, stdout: '[]', stderr: '' })
    })
})

test('only ENOENT and ESRCH are tolerated; genuine read failures still fail the probe', async () => {
    await withProcFixture(async (directory) => {
        await mkdir(join(directory, '10'))
        await Promise.all(
            ['ENOENT', 'ESRCH'].map(async (code) => {
                expect(
                    await readCrowdSecEngineUids(directory, async () => {
                        throw Object.assign(new Error('process exited'), { code })
                    }),
                ).toEqual([])
            }),
        )
        await Promise.all(
            ['EACCES', 'EIO', 'ENOTDIR'].map(async (code) => {
                const failure = Object.assign(new Error('read failed'), { code })
                await expect(
                    readCrowdSecEngineUids(directory, async () => {
                        throw failure
                    }),
                ).rejects.toBe(failure)
            }),
        )
        await mkdir(join(directory, '10/status'))
        const child = Bun.spawn(
            [process.execPath, '--no-env-file', '-e', crowdSecEngineUidProbe(directory)],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        const [exit, stdout] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
        ])
        expect(exit).not.toBe(0)
        expect(stdout).toBe('')
    })
})

test('an engine without its UID is rejected instead of being treated as stopped', async () => {
    await withProcFixture(async (directory) => {
        await mkdir(join(directory, '10'))
        await writeFile(join(directory, '10/status'), 'Name:\tcrowdsec\n')
        await expect(readCrowdSecEngineUids(directory)).rejects.toThrow('missing its UID')
    })
})
