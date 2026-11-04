import { chmod, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDeploymentEnvironmentVariable } from '../web/src/lib/Environment/deployment-environment.ts'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const defaultComposeFile = join(repositoryRoot, 'docker-compose.yml')
const applianceService = 'rentnerproxy'
const databaseHost = '127.0.0.1'
const bootstrapScript = '/opt/rentnerproxy/web/docker/web/bootstrap-secrets.ts'
const healthcheckScript = '/opt/rentnerproxy/web/docker/web/healthcheck.ts'
import {
    postgresCommand,
    controllerRestoreCommand,
    crowdSecRestoreCommand,
} from './backup/volume-commands.ts'
export { postgresCommand, postgresRestoreCommand } from './backup/volume-commands.ts'
import { waitForApplianceReadiness } from './backup/appliance-readiness.ts'
import { createMaintenanceCommands } from './backup/maintenance-commands.ts'
import { commandOption, composeArguments, readComposeProject } from './backup/compose.ts'
import { assertDeploymentCompatible } from './backup/format.ts'
import { snapshotProductionRestore } from './backup/restore-snapshot.ts'
import { deploymentSchema } from './backup/validation.ts'
import { smokeDockerArguments } from './smoke/resources.ts'

const commands = createMaintenanceCommands({
    cwd: repositoryRoot,
    operation: 'restore',
    transformArguments: smokeDockerArguments,
})

function optionValue(argumentsList: string[], name: string): string | undefined {
    return commandOption(argumentsList, name, 'restore')
}

function composeProject(argumentsList: string[]): string | undefined {
    return readComposeProject(argumentsList, process.env.COMPOSE_PROJECT_NAME, 'restore')
}

const composeCommand = composeArguments
const runCommand = commands.text

async function waitForAppliance(compose: string[]): Promise<void> {
    await waitForApplianceReadiness((timeoutMs) =>
        runCommand(
            [...compose, 'exec', '--no-TTY', applianceService, 'bun', healthcheckScript],
            'wait for appliance',
            timeoutMs,
        ),
    )
}

async function restore(): Promise<void> {
    const argumentsList = process.argv.slice(2)
    const inputOption = optionValue(argumentsList, '--input')
    if (!inputOption || !argumentsList.includes('--confirm-replace'))
        throw new Error('restore requires --input and --confirm-replace')
    const inputPath = resolve(inputOption)
    const snapshot = await mkdtemp(join(tmpdir(), 'rentnerproxy-restore-'))
    await chmod(snapshot, 0o700)
    try {
        const { metadata, backupId } = await snapshotProductionRestore(inputPath, snapshot)

        const project = composeProject(argumentsList)
        const composeFile = resolve(process.env.RENTNERPROXY_COMPOSE_FILE ?? defaultComposeFile)
        await stat(composeFile)
        const compose = composeCommand(project, composeFile)
        const config = JSON.parse(
            await runCommand([...compose, 'config', '--format=json'], 'inspect deployment'),
        ) as {
            services: {
                rentnerproxy: { image: string; environment: Record<string, string | null> }
            }
        }
        const service = config.services.rentnerproxy
        const deployment = deploymentSchema.parse({
            publicOrigin: readDeploymentEnvironmentVariable('PUBLIC_ORIGIN', service.environment),
            trustedProxyCidrs:
                readDeploymentEnvironmentVariable(
                    'PROXY_TRUSTED_PROXY_CIDRS',
                    service.environment,
                ) ?? '',
        })
        assertDeploymentCompatible(
            metadata,
            deployment,
            argumentsList.includes('--allow-deployment-change'),
        )
        const imageId = await runCommand(
            ['docker', 'image', 'inspect', '--format={{.Id}}', service.image],
            'inspect restore image',
        )
        if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error('invalid restore target image')
        await runCommand(
            [
                'docker',
                'run',
                '--rm',
                '--network=none',
                '--entrypoint=bash',
                '--volume',
                snapshot + ':/backup:ro',
                imageId,
                '-c',
                postgresCommand(true),
            ],
            'restore PostgreSQL',
            360_000,
        )

        const keyVolume = snapshot + ':/restore-key:ro'
        const archiveVolume = snapshot + ':/backup:ro'
        const bootstrap = (operation: string) => [
            ...compose,
            'run',
            '--no-TTY',
            '--rm',
            '--no-deps',
            '--entrypoint=bun',
            '--env',
            'RENTNERPROXY_DATABASE_HOST=' + databaseHost,
            '--env',
            'RENTNERPROXY_RESTORE_BACKUP_ID=' + backupId,
            '--env',
            'RENTNERPROXY_RESTORE_RESUME=' + argumentsList.includes('--resume'),
            '--volume',
            keyVolume,
            applianceService,
            bootstrapScript,
            operation,
        ]
        const pending = await runCommand(
            bootstrap('inspect-production-restore'),
            'inspect pending restore',
        )
        if (pending && (!argumentsList.includes('--resume') || pending !== backupId))
            throw new Error('interrupted restore requires --resume with the same backup')
        if (!pending && argumentsList.includes('--resume'))
            throw new Error('no interrupted restore is pending')
        await runCommand(
            [...compose, 'stop', '--timeout', '30', applianceService],
            'quiesce restore target',
            180_000,
        )
        // Preparing a fresh database must never boot the old controller/web workers.
        // A resumed restore already has its initialized cluster and must retain its journal/key state.
        if (!pending)
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=/usr/local/bin/rentnerproxy-production',
                    applianceService,
                    '--initialize-restore-target',
                ],
                'initialize restore target',
                180_000,
            )
        // The journal hook durably pauses root-owned off-host uploads and retention on
        // fresh and resumed restores before changing keys or restarting any writers.
        try {
            await runCommand(
                bootstrap('begin-production-restore'),
                'stage production restore and pause off-host backups',
            )
        } catch (error) {
            // runCommand exposes only its sanitized operation/cleanup message, never bootstrap stderr.
            const failure =
                error instanceof Error
                    ? error.message
                    : 'production restore operation failed: stage production restore and pause off-host backups'
            throw new Error(
                failure +
                    '. Restore staging interrupted; appliance remains stopped. If the restore journal was written, rerun the same backup with --resume --confirm-replace.',
                { cause: error },
            )
        }
        try {
            await runCommand(
                bootstrap('begin-app-key-restore'),
                'stage application encryption key restore',
            )
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=bash',
                    '--env',
                    'RENTNERPROXY_RESTORE_PHASE=database',
                    '--volume',
                    archiveVolume,
                    applianceService,
                    '-c',
                    postgresCommand(false),
                ],
                'restore PostgreSQL',
                360_000,
            )

            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=bash',
                    '--volume',
                    archiveVolume,
                    applianceService,
                    '-c',
                    controllerRestoreCommand(),
                ],
                'restore controller state',
                180_000,
            )
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=bash',
                    '--volume',
                    archiveVolume,
                    applianceService,
                    '-c',
                    crowdSecRestoreCommand(),
                ],
                'restore managed CrowdSec state',
                180_000,
            )
            await runCommand(
                [
                    ...compose,
                    'run',
                    '--no-TTY',
                    '--rm',
                    '--no-deps',
                    '--entrypoint=sync',
                    applianceService,
                    '--file-system',
                    '/var/lib/rentnerproxy',
                ],
                'flush restored state',
            )
            await runCommand(
                bootstrap('complete-app-key-restore'),
                'complete application encryption key restore',
            )
            await runCommand(
                bootstrap('complete-production-restore'),
                'complete production restore',
            )
        } catch (error) {
            const failure =
                error instanceof Error ? error.message : 'production restore operation failed'
            throw new Error(
                failure +
                    '. Restore interrupted; appliance remains stopped; rerun the same backup with --resume --confirm-replace',
                { cause: error },
            )
        }
        await runCommand(
            [...compose, 'up', '--detach', '--force-recreate', applianceService],
            'start restored appliance',
            600_000,
        )
        await waitForAppliance(compose)
        console.log('Production restore completed from: ' + inputPath)
    } finally {
        await rm(snapshot, { force: true, recursive: true })
    }
}

if (import.meta.main) {
    try {
        await restore()
    } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown restore error'
        console.error(
            'Production restore failed: ' +
                message +
                '. No automatic destructive retry was attempted.',
        )
        process.exitCode = 1
    }
}
