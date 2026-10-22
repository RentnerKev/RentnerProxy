import { describe, expect, test } from 'bun:test'
import { createMaintenanceCommands } from '../../../../../../scripts/backup/maintenance-commands.ts'
import {
    commandOption,
    composeArguments,
    readComposeProject,
} from '../../../../../../scripts/backup/compose.ts'
import type {
    MaintenanceProcessOptions,
    MaintenanceProcessResult,
} from '../../../../../../scripts/backup/Types/maintenance-process.types.ts'
import { smokeDockerArguments } from '../../../../../../scripts/smoke/resources.ts'

function result(
    stdout = '',
    overrides: Partial<MaintenanceProcessResult> = {},
): MaintenanceProcessResult {
    return {
        exitCode: 0,
        failed: false,
        timedOut: false,
        stopped: true,
        stdout: new TextEncoder().encode(stdout),
        stderr: '',
        ...overrides,
    }
}

function fixture(
    mode:
        | 'success'
        | 'absent-timeout'
        | 'absent-failure'
        | 'observed-timeout'
        | 'wrong-owner'
        | 'rm-failure'
        | 'verification-failure',
) {
    const calls: Array<{ args: string[]; options: MaintenanceProcessOptions }> = []
    let name = '',
        owner = '',
        removed = false
    const id = 'b'.repeat(64)
    const runner = async (args: readonly string[], options: MaintenanceProcessOptions) => {
        calls.push({ args: [...args], options })
        if (args.includes('--name')) {
            name = args[args.indexOf('--name') + 1]!
            owner = args[args.indexOf('--label') + 1]!.split('=')[1]!
            if (mode === 'success') return result('  binary\0value\n')
            return result('', {
                exitCode: mode === 'absent-failure' ? 7 : 0,
                failed: true,
                timedOut: mode !== 'absent-failure',
                stderr: 'secret must not leak RESTORE_PHASE=execute ERROR: 23514 BACKUP_VALIDATION=application_key',
            })
        }
        if (args[1] === 'container' && args[2] === 'ls') {
            if (
                mode === 'success' ||
                mode === 'absent-timeout' ||
                mode === 'absent-failure' ||
                (removed && mode !== 'verification-failure')
            )
                return result()
            return result(JSON.stringify({ ID: id, Names: name }))
        }
        if (args[1] === 'container' && args[2] === 'inspect')
            return result(
                JSON.stringify({
                    Id: id,
                    Name: '/' + name,
                    Config: {
                        Labels: {
                            'io.rentnerproxy.maintenance-run':
                                mode === 'wrong-owner' ? 'somebody-else' : owner,
                        },
                    },
                }),
            )
        if (args[1] === 'container' && args[2] === 'rm') {
            if (mode === 'rm-failure') return result('', { exitCode: 1, failed: true })
            removed = true
            return result()
        }
        return result(' ordinary output \n')
    }
    return { runner, calls }
}

describe('owned maintenance commands', () => {
    test('preserves text/byte/input defaults and explicit overrides', async () => {
        const { runner, calls } = fixture('success')
        const commands = createMaintenanceCommands({
            cwd: '/fixture',
            operation: 'backup',
            process: runner,
        })
        expect(await commands.text(['docker', 'inspect', 'fixture'], 'inspect')).toBe(
            'ordinary output',
        )
        expect(
            Buffer.from(
                await commands.bytes(['docker', 'run', '--rm', 'fixture'], 'archive'),
            ).toString(),
        ).toBe('  binary\0value\n')
        await commands.input(
            ['docker', 'run', '--rm', 'fixture'],
            new Uint8Array([0, 255]),
            'restore',
        )
        await commands.text(['docker', 'inspect', 'fixture'], 'inspect', 42)
        const operations = calls.filter((call) => call.args[1] !== 'container')
        expect(operations.map((call) => call.options.timeoutMs)).toEqual([
            120_000, 300_000, 360_000, 42,
        ])
        expect(operations[2]!.options.input).toEqual(new Uint8Array([0, 255]))
        commands.assertRestartSafe()
    })

    test.each([
        'absent-timeout',
        'absent-failure',
        'wrong-owner',
        'rm-failure',
        'verification-failure',
    ] as const)('fails closed for %s and blocks every later startup', async (mode) => {
        const { runner, calls } = fixture(mode)
        const commands = createMaintenanceCommands({
            cwd: '/fixture',
            operation: 'backup',
            process: runner,
        })
        await expect(commands.bytes(['docker', 'run', '--rm', 'fixture'], 'dump')).rejects.toThrow(
            'cleanup unresolved',
        )
        expect(() => commands.assertRestartSafe()).toThrow('startup is blocked')
        const count = calls.length
        await expect(
            commands.text(
                ['docker', 'compose', '--file', '/fixture.yml', 'start', 'rentnerproxy'],
                'restart',
            ),
        ).rejects.toThrow('startup is blocked')
        expect(calls).toHaveLength(count)
        if (mode === 'wrong-owner' || mode.startsWith('absent'))
            expect(calls.some((call) => call.args[2] === 'rm')).toBe(false)
    })

    test('removes only an observed owned ID, verifies absence, and allows restart after timeout cleanup', async () => {
        const { runner, calls } = fixture('observed-timeout')
        const commands = createMaintenanceCommands({
            cwd: '/fixture',
            operation: 'backup',
            process: runner,
        })
        await expect(commands.bytes(['docker', 'run', '--rm', 'fixture'], 'dump')).rejects.toThrow(
            'production backup operation failed: dump',
        )
        commands.assertRestartSafe()
        await commands.text(
            ['docker', 'compose', '--file', '/fixture.yml', 'start', 'rentnerproxy'],
            'restart',
        )
        const removal = calls.findIndex((call) => call.args[2] === 'rm')
        expect(calls[removal]!.args).toEqual([
            'docker',
            'container',
            'rm',
            '--force',
            'b'.repeat(64),
        ])
        expect(calls[removal + 1]!.args[2]).toBe('ls')
        expect(calls[removal + 2]!.args).toContain('start')
    })

    test('keeps allowlisted restore diagnostics without leaking raw stderr even when cleanup fails', async () => {
        const { runner } = fixture('absent-failure')
        const commands = createMaintenanceCommands({
            cwd: '/fixture',
            operation: 'restore',
            process: runner,
        })
        try {
            await commands.input(
                ['docker', 'run', '--rm', 'fixture'],
                new Uint8Array(),
                'restore PostgreSQL',
            )
            throw new Error('expected failure')
        } catch (error) {
            expect((error as Error).message).toContain(
                'Backup validation: application_key; Restore database phase: execute; SQLSTATE: 23514.',
            )
            expect((error as Error).message).not.toContain('secret must not leak')
        }
    })

    test('keeps smoke labels on direct runs and identifies Compose run after project/file options', async () => {
        const { runner, calls } = fixture('success')
        const commands = createMaintenanceCommands({
            cwd: '/fixture',
            operation: 'restore',
            process: runner,
            transformArguments: (args) => smokeDockerArguments(args),
        })
        await commands.text(
            [...composeArguments('run', '/run'), 'run', '--rm', 'rentnerproxy'],
            'bootstrap',
        )
        expect(calls[0]!.args.slice(0, 7)).toEqual([
            'docker',
            'compose',
            '--project-name',
            'run',
            '--file',
            '/run',
            'run',
        ])
        expect(calls[0]!.args).toContain('--name')
        const previous = process.env.RENTNERPROXY_SMOKE_RUN
        try {
            process.env.RENTNERPROXY_SMOKE_RUN = 'local-0123456789ab'
            await commands.text(['docker', 'run', '--rm', 'fixture'], 'validation')
            const direct = calls.find((call) => call.args[1] === 'run')!
            expect(direct.args).toContain('io.rentnerproxy.smoke-run=local-0123456789ab')
            expect(
                direct.args.some((argument) =>
                    argument.startsWith('io.rentnerproxy.maintenance-run='),
                ),
            ).toBe(true)
        } finally {
            if (previous === undefined) delete process.env.RENTNERPROXY_SMOKE_RUN
            else process.env.RENTNERPROXY_SMOKE_RUN = previous
        }
    })
})

test('shared Compose options preserve validation and explicit-project precedence', () => {
    expect(commandOption(['--output', 'value'], '--output', 'backup')).toBe('value')
    expect(() => commandOption(['--input', '--confirm'], '--input', 'restore')).toThrow(
        'invalid restore options',
    )
    expect(readComposeProject(['--project', 'run'], 'default', 'backup')).toBe('run')
    expect(readComposeProject([], '  project  ', 'restore')).toBe('project')
    expect(() => readComposeProject([], '../other', 'backup')).toThrow(
        'invalid Compose project name',
    )
})
