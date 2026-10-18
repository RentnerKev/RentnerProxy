import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
    PUBLISHED_RELEASES,
    publishedRelease,
} from '../../../../../scripts/compatibility/published-releases.ts'

const root = resolve(import.meta.dir, '../../../../..')
const workflow = Bun.YAML.parse(
    await readFile(join(root, '.github/workflows/release-compatibility.yml'), 'utf8'),
) as {
    jobs: { 'select-sources': { steps: { run: string }[] } }
}
const selection = workflow.jobs['select-sources'].steps[0]!.run
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'

async function select(event: string, source: string) {
    const directory = await mkdtemp(join(tmpdir(), 'rp-release-matrix-'))
    const output = join(directory, 'output').replaceAll('\\', '/')
    try {
        const child = Bun.spawn([bash, '--noprofile', '--norc', '-c', selection], {
            env: {
                ...process.env,
                EVENT_NAME: event,
                REQUESTED_SOURCE: source,
                GITHUB_OUTPUT: output,
            },
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const timer = setTimeout(() => child.kill(), 5_000)
        try {
            const [exitCode, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ])
            return {
                exitCode,
                stdout,
                stderr,
                output: await readFile(output, 'utf8').catch(() => ''),
            }
        } finally {
            clearTimeout(timer)
        }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}

describe('beta upgrade source selection', () => {
    test.each([
        ['push', '', '["fresh","beta.1"]'],
        ['pull_request', '', '["fresh","beta.1"]'],
        ['workflow_dispatch', 'all', '["fresh","beta.1"]'],
        ['workflow_dispatch', '', '["beta.1"]'],
        ['workflow_dispatch', 'fresh', '["fresh"]'],
        ['workflow_dispatch', 'beta.1', '["beta.1"]'],
    ])('%s %s selects supported sources', async (event, source, expected) => {
        expect(await select(event!, source!)).toEqual({
            exitCode: 0,
            stdout: '',
            stderr: '',
            output: `sources=${expected}\n`,
        })
    })

    test.each(['alpha.1', 'alpha.6', 'beta.2', 'beta.1,alpha.6'])(
        'rejects unsupported source %s',
        async (source) => {
            expect(await select('workflow_dispatch', source)).toMatchObject({
                exitCode: 1,
                output: '',
            })
        },
    )

    test('pins beta.1 to the published image and revision', () => {
        expect(Object.keys(PUBLISHED_RELEASES)).toEqual(['beta.1'])
        expect(publishedRelease('beta.1')).toEqual({
            version: 'v1.0.0-beta.1',
            revision: '9efb498bac2cc12fef4823ee7ac9b31444a5ab54',
            digest: 'sha256:f50faba7ab60c4020790576032cc46350778b8cee1eda5cb8efbfa00333c5d9e',
            image: 'ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.1@sha256:f50faba7ab60c4020790576032cc46350778b8cee1eda5cb8efbfa00333c5d9e',
        })
    })
})
