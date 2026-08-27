import { fileURLToPath } from 'node:url'

import { logger as defaultLogger } from './logger'
import type {
    DevelopmentDependencies,
    DevelopmentEvent,
    ManagedProcess,
    RunningService,
    ServiceDefinition,
    ShutdownSignal,
    SpawnRequest,
} from './Types/development.types'

const SHUTDOWN_TIMEOUT_MS = 5_000

const services: readonly ServiceDefinition[] = [
    { label: 'Web server', script: 'dev:web' },
    { label: 'Controller', script: 'dev:controller' },
]

function spawnProcess(request: SpawnRequest): ManagedProcess {
    return Bun.spawn({
        cmd: request.command,
        cwd: request.cwd,
        stdin: request.stdin,
        stdout: request.stdout,
        stderr: request.stderr,
        detached: request.detached,
    })
}

function signalProcessTree(childProcess: ManagedProcess, signal: NodeJS.Signals): void {
    if (process.platform === 'win32') {
        childProcess.kill(signal)
        return
    }

    process.kill(-childProcess.pid, signal)
}

function addSignalHandler(signal: ShutdownSignal, handler: () => void): void {
    process.on(signal, handler)
}

function removeSignalHandler(signal: ShutdownSignal, handler: () => void): void {
    process.off(signal, handler)
}

const defaultDependencies: DevelopmentDependencies = {
    logger: defaultLogger,
    platform: process.platform,
    repositoryRoot: fileURLToPath(new URL('..', import.meta.url)),
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    spawn: spawnProcess,
    signalProcessTree,
    onSignal: addSignalHandler,
    offSignal: removeSignalHandler,
}

function isRunning(service: RunningService): boolean {
    return service.process.exitCode === null && service.process.signalCode === null
}

function signalServices(
    runningServices: readonly RunningService[],
    signal: NodeJS.Signals,
    dependencies: DevelopmentDependencies,
): void {
    for (const service of runningServices) {
        if (!isRunning(service)) {
            continue
        }

        try {
            dependencies.signalProcessTree(service.process, signal)
        } catch {
            dependencies.logger.warning(`Could not send ${signal} to ${service.label}`)
        }
    }
}

async function waitForServices(
    runningServices: readonly RunningService[],
    dependencies: DevelopmentDependencies,
): Promise<void> {
    const allExited = Promise.allSettled(
        runningServices.map((service) => service.process.exited),
    ).then(() => true)
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<boolean>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(false), dependencies.shutdownTimeoutMs)
    })
    const exitedBeforeTimeout = await Promise.race([allExited, timedOut])

    if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle)
    }

    if (exitedBeforeTimeout) {
        return
    }

    dependencies.logger.warning('Graceful shutdown timed out; forcing remaining processes to stop')
    signalServices(runningServices, 'SIGKILL', dependencies)
    await Promise.allSettled(runningServices.map((service) => service.process.exited))
}

async function stopServices(
    runningServices: readonly RunningService[],
    signal: ShutdownSignal,
    dependencies: DevelopmentDependencies,
): Promise<void> {
    const windowsConsoleHandlesInterrupt = dependencies.platform === 'win32' && signal === 'SIGINT'

    if (!windowsConsoleHandlesInterrupt) {
        signalServices(runningServices, signal, dependencies)
    }

    await waitForServices(runningServices, dependencies)
}

function formatSpawnError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

export async function runDevelopment(
    overrides: Partial<DevelopmentDependencies> = {},
): Promise<number> {
    const dependencies = { ...defaultDependencies, ...overrides }
    const runningServices: RunningService[] = []
    let receivedSignal: ShutdownSignal | null = null
    let resolveSignal: ((signal: ShutdownSignal) => void) | null = null
    const signalPromise = new Promise<ShutdownSignal>((resolve) => {
        resolveSignal = resolve
    })

    function receiveSignal(signal: ShutdownSignal): void {
        if (receivedSignal !== null) {
            return
        }

        receivedSignal = signal
        resolveSignal?.(signal)
    }

    const handleInterrupt = () => receiveSignal('SIGINT')
    const handleTerminate = () => receiveSignal('SIGTERM')

    dependencies.onSignal('SIGINT', handleInterrupt)
    dependencies.onSignal('SIGTERM', handleTerminate)

    async function runSession(): Promise<number> {
        dependencies.logger.info('Starting RentnerProxy development environment')

        try {
            for (const service of services) {
                dependencies.logger.info(`Starting ${service.label.toLowerCase()}`)

                const childProcess = dependencies.spawn({
                    command: [process.execPath, '--no-orphans', 'run', '--silent', service.script],
                    cwd: dependencies.repositoryRoot,
                    stdin: 'inherit',
                    stdout: 'inherit',
                    stderr: 'inherit',
                    detached: dependencies.platform !== 'win32',
                })

                runningServices.push({ ...service, process: childProcess })
                dependencies.logger.success(`${service.label} process started`)
            }
        } catch (error) {
            dependencies.logger.fail(
                `Development process failed to start: ${formatSpawnError(error)}`,
            )
            await stopServices(runningServices, 'SIGTERM', dependencies)
            return 1
        }

        dependencies.logger.done('RentnerProxy development processes are running')

        const events: Array<Promise<DevelopmentEvent>> = [
            signalPromise.then((signal) => ({ kind: 'signal', signal })),
            ...runningServices.map((service) =>
                service.process.exited.then((exitCode): DevelopmentEvent => ({
                    kind: 'child-exit',
                    service,
                    exitCode,
                })),
            ),
        ]
        const event = await Promise.race(events)

        if (receivedSignal !== null) {
            dependencies.logger.info(`Received ${receivedSignal}; stopping development processes`)
            await stopServices(runningServices, receivedSignal, dependencies)
            dependencies.logger.done('RentnerProxy development environment stopped')
            return receivedSignal === 'SIGINT' ? 130 : 143
        }

        if (event.kind !== 'child-exit') {
            return 1
        }

        if (event.exitCode === 0) {
            dependencies.logger.warning(`${event.service.label} stopped`)
        } else {
            dependencies.logger.fail(`${event.service.label} exited with code ${event.exitCode}`)
        }

        await stopServices(runningServices, 'SIGTERM', dependencies)
        return event.exitCode
    }

    try {
        return await runSession()
    } finally {
        dependencies.offSignal('SIGINT', handleInterrupt)
        dependencies.offSignal('SIGTERM', handleTerminate)
    }
}

if (import.meta.main) {
    process.exitCode = await runDevelopment()
}
