import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { runMaintenanceProcess } from '../../../../../../scripts/backup/maintenance-process.ts'

const cwd = resolve(import.meta.dir, '../../../../../..')
const child = (script: string) => [process.execPath, '--no-env-file', '-e', script]

describe('maintenance process deadline includes all I/O', () => {
    test('preserves binary stdin/stdout and drains stderr concurrently', async () => {
        const input = Uint8Array.from({ length: 200_000 }, (_, index) => index % 256)
        const result = await runMaintenanceProcess(
            child(
                "process.stderr.write('diagnostic'); process.stdout.write(await Bun.stdin.bytes())",
            ),
            { cwd, timeoutMs: 5_000, input },
        )
        expect(result.failed).toBe(false)
        expect(result.stopped).toBe(true)
        expect(result.stdout).toEqual(input)
        expect(result.stderr).toBe('diagnostic')
    })

    test('bounds a blocked input flush and kills a SIGTERM-ignoring child', async () => {
        const result = await runMaintenanceProcess(
            child("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"),
            { cwd, timeoutMs: 100, input: new Uint8Array(4 * 1024 * 1024) },
        )
        expect(result.timedOut).toBe(true)
        expect(result.failed).toBe(true)
        expect(result.stopped).toBe(true)
    })

    test('fails closed when the child exits before consuming input', async () => {
        const result = await runMaintenanceProcess(child('process.exit(0)'), {
            cwd,
            timeoutMs: 5_000,
            input: new Uint8Array(4 * 1024 * 1024),
        })
        expect(result.failed).toBe(true)
        expect(result.timedOut).toBe(false)
        expect(result.stopped).toBe(true)
    })

    test.skipIf(process.platform === 'win32')(
        'bounds inherited pipes even when the command itself exits successfully',
        async () => {
            const result = await runMaintenanceProcess(
                child(
                    "Bun.spawn([process.execPath, '--no-env-file', '-e', 'setInterval(() => {}, 1000)'], {stdout:'inherit',stderr:'inherit',stdin:'ignore'}); process.exit(0)",
                ),
                { cwd, timeoutMs: 200 },
            )
            expect(result.exitCode).toBe(0)
            expect(result.timedOut).toBe(true)
            expect(result.failed).toBe(true)
            expect(result.stopped).toBe(true)
        },
    )

    test('retains bounded diagnostic context and unsuccessful exit status', async () => {
        const result = await runMaintenanceProcess(
            child(
                "process.stderr.write('x'.repeat(100_000) + 'RESTORE_PHASE=execute'); process.exitCode = 7",
            ),
            { cwd, timeoutMs: 5_000 },
        )
        expect(result.failed).toBe(true)
        expect(result.exitCode).toBe(7)
        expect(result.timedOut).toBe(false)
        expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(65_536)
        expect(result.stderr).toContain('RESTORE_PHASE=execute')
    })

    test('rejects invalid timeout before dispatch', async () => {
        await expect(runMaintenanceProcess([], { cwd, timeoutMs: Infinity })).rejects.toThrow(
            'positive and finite',
        )
    })
})
