import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSmokeProcess } from '../../../../../../scripts/smoke/process.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../../..', import.meta.url))
const options = { cwd: repositoryRoot, timeoutMs: 5_000 }

function childArguments(code: string): string[] {
    return [process.execPath, '--no-env-file', '-e', code]
}

describe('runSmokeProcess', () => {
    test('drains stdout and stderr concurrently without trimming output', async () => {
        const result = await runSmokeProcess(
            childArguments(
                "process.stdout.write('out'.repeat(50_000)); process.stderr.write('err'.repeat(50_000))",
            ),
            options,
        )
        expect(result).toEqual({
            exitCode: 0,
            stdout: 'out'.repeat(50_000),
            stderr: 'err'.repeat(50_000),
            timedOut: false,
        })
    })

    test('returns unsuccessful exit codes for caller policy', async () => {
        const result = await runSmokeProcess(
            childArguments("process.stderr.write('expected failure\\n'); process.exit(7)"),
            options,
        )
        expect(result.exitCode).toBe(7)
        expect(result.stderr).toBe('expected failure\n')
        expect(result.timedOut).toBeFalse()
    })

    test('supports inherited build output without trying to drain absent pipes', async () => {
        const result = await runSmokeProcess(childArguments('process.exit(0)'), {
            ...options,
            inherit: true,
        })
        expect(result).toEqual({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
    })

    test('supplies the requested working directory, environment and stdin', async () => {
        const cwd = resolve(repositoryRoot, 'scripts')
        const result = await runSmokeProcess(
            childArguments(
                'process.stdout.write(JSON.stringify({cwd:process.cwd(), value:process.env.SMOKE_TEST_VALUE, input:await Bun.stdin.text()}))',
            ),
            { ...options, cwd, env: { SMOKE_TEST_VALUE: 'fixture value' }, stdin: 'hello\n' },
        )
        expect(result.exitCode).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual({
            cwd,
            value: 'fixture value',
            input: 'hello\n',
        })
    })

    test('kills a process at its timeout', async () => {
        const result = await runSmokeProcess(childArguments('setInterval(() => {}, 1_000)'), {
            ...options,
            timeoutMs: 100,
        })
        expect(result.timedOut).toBeTrue()
        expect(result.exitCode).not.toBe(0)
    })

    test('rejects an unbounded timeout before spawning', async () => {
        await expect(runSmokeProcess([], { ...options, timeoutMs: Infinity })).rejects.toThrow(
            'positive finite number',
        )
        await expect(runSmokeProcess([], { ...options, timeoutMs: 0 })).rejects.toThrow(
            'positive finite number',
        )
    })
})
