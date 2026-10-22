import { randomUUID } from 'node:crypto'
import { open, rm, type FileHandle } from 'node:fs/promises'
import { runMaintenanceProcess } from './maintenance-process.ts'
import type { MaintenanceCommandOptions } from './Types/maintenance-commands.types.ts'

const ownerLabel = 'io.rentnerproxy.maintenance-run'

function runIndex(args: readonly string[]): number {
    if (args[0] !== 'docker') return -1
    if (args[1] === 'run') return 1
    if (args[1] !== 'compose') return -1
    let index = 2
    while (args[index] === '--project-name' || args[index] === '--file') index += 2
    return args[index] === 'run' ? index : -1
}

export function createMaintenanceCommands(options: MaintenanceCommandOptions) {
    const execute = options.process ?? runMaintenanceProcess
    let restartSafe = true
    const transform = options.transformArguments ?? ((args: string[]) => args)

    async function cleanup(name: string, owner: string, uncertain: boolean): Promise<void> {
        const deadline = performance.now() + 10_000
        async function command(args: string[]) {
            const remaining = deadline - performance.now()
            if (remaining <= 0) throw new Error('maintenance cleanup deadline exceeded')
            const result = await execute(transform(args), {
                cwd: options.cwd,
                timeoutMs: remaining,
            })
            if (result.failed || !result.stopped) throw new Error('maintenance cleanup failed')
            return Buffer.from(result.stdout).toString('utf8').trim()
        }
        const listArgs = [
            'docker',
            'container',
            'ls',
            '--all',
            '--no-trunc',
            '--filter',
            'name=^/' + name + '$',
            '--format={{json .}}',
        ]
        const listing = await command(listArgs)
        if (!listing) {
            // A timed-out/failed create may still be completing in the daemon.
            // Only a successful run proves that --rm has already finished.
            if (uncertain) throw new Error('maintenance container creation could not be ruled out')
            return
        }
        const rows = listing.split('\n').map((line): unknown => JSON.parse(line))
        if (rows.length !== 1) throw new Error('ambiguous maintenance container')
        const row = rows[0] as { ID?: unknown; Names?: unknown }
        if (row.Names !== name || typeof row.ID !== 'string' || !/^[a-f0-9]{64}$/u.test(row.ID))
            throw new Error('invalid maintenance container identity')
        const inspected: unknown = JSON.parse(
            await command([
                'docker',
                'container',
                'inspect',
                '--format={"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Labels":{{json .Config.Labels}}}}',
                row.ID,
            ]),
        )
        const identity = inspected as {
            Id?: unknown
            Name?: unknown
            Config?: { Labels?: Record<string, unknown> }
        }
        if (
            identity.Id !== row.ID ||
            identity.Name !== '/' + name ||
            identity.Config?.Labels?.[ownerLabel] !== owner
        )
            throw new Error('maintenance container ownership mismatch')
        await command(['docker', 'container', 'rm', '--force', row.ID])
        if (await command(listArgs))
            throw new Error('maintenance container removal could not be verified')
    }

    async function run(
        args: readonly string[],
        operation: string,
        timeoutMs: number,
        input?: Uint8Array,
        outputFile?: { file: FileHandle; maximumBytes: number },
    ) {
        if (!restartSafe)
            throw new Error(
                'Maintenance cleanup unresolved; automatic appliance startup is blocked.',
            )
        const index = runIndex(args)
        const owner = randomUUID()
        const name = 'rentnerproxy-maintenance-' + owner
        const prepared = [...args]
        if (index >= 0)
            prepared.splice(index + 1, 0, '--name', name, '--label', ownerLabel + '=' + owner)
        let result: Awaited<ReturnType<typeof execute>> | undefined
        let cleanupFailed = false
        try {
            result = await execute(transform(prepared), {
                cwd: options.cwd,
                timeoutMs,
                ...(input === undefined ? {} : { input }),
                ...(outputFile ? { outputFile } : {}),
            })
        } catch {
            // Spawn/transport failures use the same sanitized operation contract.
        } finally {
            if (index >= 0) {
                try {
                    await cleanup(
                        name,
                        owner,
                        result === undefined || result.failed || !result.stopped,
                    )
                } catch {
                    restartSafe = false
                    cleanupFailed = true
                }
            }
        }
        if (cleanupFailed || !result || result.failed || !result.stopped) {
            const prefix = 'production ' + options.operation + ' operation failed: ' + operation
            const cleanupMessage = cleanupFailed
                ? ' Maintenance cleanup unresolved; automatic appliance startup is blocked.'
                : ''
            if (options.operation !== 'restore' || operation !== 'restore PostgreSQL')
                throw new Error(prefix + (cleanupFailed ? '.' + cleanupMessage : ''))
            const phase = /RESTORE_PHASE=(initialize|archive|render|assemble|execute)/u.exec(
                result?.stderr ?? '',
            )?.[1]
            const sqlState = /ERROR:\s*(?:[0-9A-Z]{5}:\s*)?([0-9A-Z]{5})\b/u.exec(
                result?.stderr ?? '',
            )?.[1]
            const validation =
                /BACKUP_VALIDATION=(database_version|migration_history|application_key|crowdsec_archive|crowdsec_database|crowdsec_credentials|runtime_validation)/u.exec(
                    result?.stderr ?? '',
                )?.[1]
            const details = [
                validation ? 'Backup validation: ' + validation : null,
                phase ? 'Restore database phase: ' + phase : null,
                sqlState ? 'SQLSTATE: ' + sqlState : null,
            ].filter(Boolean)
            throw new Error(
                prefix +
                    '.' +
                    (details.length ? ' ' + details.join('; ') + '.' : '') +
                    cleanupMessage,
            )
        }
        return result
    }

    return {
        assertRestartSafe() {
            if (!restartSafe)
                throw new Error(
                    'Maintenance cleanup unresolved; automatic appliance startup is blocked.',
                )
        },
        async text(args: readonly string[], operation: string, timeoutMs = 120_000) {
            return Buffer.from((await run(args, operation, timeoutMs)).stdout)
                .toString('utf8')
                .trim()
        },
        async bytes(args: readonly string[], operation: string, timeoutMs = 300_000) {
            return (await run(args, operation, timeoutMs)).stdout
        },
        async file(args: readonly string[], path: string, operation: string, timeoutMs = 300_000) {
            const file = await open(path, 'wx', 0o600)
            let success = false
            try {
                await file.chmod(0o600)
                const result = await run(args, operation, timeoutMs, undefined, {
                    file,
                    maximumBytes: 8 * 1024 ** 3,
                })
                if (!result.artifact) throw new Error('missing backup artifact result')
                await file.sync()
                success = true
                return result.artifact
            } finally {
                await file.close()
                if (!success) await rm(path, { force: true })
            }
        },
        async input(
            args: readonly string[],
            input: Uint8Array,
            operation: string,
            timeoutMs = 360_000,
        ) {
            await run(args, operation, timeoutMs, input)
        },
    }
}
