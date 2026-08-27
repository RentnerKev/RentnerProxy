import { describe, expect, test } from 'bun:test'

import { runDevelopment } from '../../../scripts/dev'
import type {
    ManagedProcess,
    ShutdownSignal,
    SpawnRequest,
} from '../../../scripts/Types/development.types'
import { createLogger } from '../../../scripts/logger'
import type { DevelopmentHarness } from './Types/development-test.types'

class FakeProcess implements ManagedProcess {
    readonly pid = 42
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    readonly exited: Promise<number>
    readonly signals: Array<number | NodeJS.Signals> = []
    private finishExit: (exitCode: number) => void = () => undefined

    constructor(private readonly exitWhenKilled = true) {
        this.exited = new Promise((resolve) => {
            this.finishExit = resolve
        })
    }

    finish(exitCode: number, signal: NodeJS.Signals | null = null): void {
        if (this.exitCode !== null || this.signalCode !== null) {
            return
        }

        this.exitCode = signal === null ? exitCode : null
        this.signalCode = signal
        this.finishExit(exitCode)
    }

    kill(signal: number | NodeJS.Signals = 'SIGTERM'): void {
        this.signals.push(signal)

        if (!this.exitWhenKilled) {
            return
        }

        const exitCode = signal === 'SIGINT' ? 130 : signal === 'SIGKILL' ? 137 : 143
        this.finish(exitCode, typeof signal === 'string' ? signal : null)
    }
}

class ForceKilledProcess extends FakeProcess {
    constructor() {
        super(false)
    }

    override kill(signal: number | NodeJS.Signals = 'SIGTERM'): void {
        super.kill(signal)

        if (signal === 'SIGKILL') {
            this.finish(137, signal)
        }
    }
}

function createHarness(
    processes: readonly ManagedProcess[],
    platform: NodeJS.Platform = 'linux',
    shutdownTimeoutMs = 5_000,
): DevelopmentHarness {
    const handlers = new Map<ShutdownSignal, () => void>()
    const requests: SpawnRequest[] = []
    const removedSignals: ShutdownSignal[] = []
    let processIndex = 0

    return {
        handlers,
        requests,
        removedSignals,
        dependencies: {
            logger: createLogger({ colors: false, write: () => undefined }),
            platform,
            repositoryRoot: 'C:\\RentnerProxy',
            shutdownTimeoutMs,
            spawn: (request) => {
                requests.push(request)
                const childProcess = processes[processIndex]
                processIndex += 1

                if (!childProcess) {
                    throw new Error('missing fake process')
                }

                return childProcess
            },
            signalProcessTree: (childProcess, signal) => childProcess.kill(signal),
            onSignal: (signal, handler) => handlers.set(signal, handler),
            offSignal: (signal) => {
                removedSignals.push(signal)
                handlers.delete(signal)
            },
        },
    }
}

describe('runDevelopment', () => {
    test('starts both services with inherited stdio and preserves a child failure code', async () => {
        const web = new FakeProcess()
        const controller = new FakeProcess()
        const harness = createHarness([web, controller])
        const result = runDevelopment(harness.dependencies)

        web.finish(7)

        expect(await result).toBe(7)
        expect(controller.signals).toEqual(['SIGTERM'])
        expect(harness.requests).toEqual([
            {
                command: [process.execPath, '--no-orphans', 'run', '--silent', 'dev:web'],
                cwd: 'C:\\RentnerProxy',
                stdin: 'inherit',
                stdout: 'inherit',
                stderr: 'inherit',
                detached: true,
            },
            {
                command: [process.execPath, '--no-orphans', 'run', '--silent', 'dev:controller'],
                cwd: 'C:\\RentnerProxy',
                stdin: 'inherit',
                stdout: 'inherit',
                stderr: 'inherit',
                detached: true,
            },
        ])
    })

    test('handles repeated SIGINT once and removes both signal listeners', async () => {
        const web = new FakeProcess()
        const controller = new FakeProcess()
        const harness = createHarness([web, controller])
        const result = runDevelopment(harness.dependencies)

        harness.handlers.get('SIGINT')?.()
        harness.handlers.get('SIGINT')?.()

        expect(await result).toBe(130)
        expect(web.signals).toEqual(['SIGINT'])
        expect(controller.signals).toEqual(['SIGINT'])
        expect(harness.removedSignals).toEqual(['SIGINT', 'SIGTERM'])
    })

    test('lets the shared Windows console deliver SIGINT before forcing children', async () => {
        const web = new FakeProcess(false)
        const controller = new FakeProcess(false)
        const harness = createHarness([web, controller], 'win32')
        const result = runDevelopment(harness.dependencies)

        harness.handlers.get('SIGINT')?.()
        web.finish(130, 'SIGINT')
        controller.finish(130, 'SIGINT')

        expect(await result).toBe(130)
        expect(web.signals).toEqual([])
        expect(controller.signals).toEqual([])
    })

    test('stops the first child when spawning the second service throws', async () => {
        const web = new FakeProcess()
        const harness = createHarness([web])

        expect(await runDevelopment(harness.dependencies)).toBe(1)
        expect(web.signals).toEqual(['SIGTERM'])
    })

    test('forces a process tree to stop after the graceful timeout', async () => {
        const web = new FakeProcess()
        const controller = new ForceKilledProcess()
        const harness = createHarness([web, controller], 'linux', 0)
        const result = runDevelopment(harness.dependencies)

        web.finish(9)

        expect(await result).toBe(9)
        expect(controller.signals).toEqual(['SIGTERM', 'SIGKILL'])
        expect(harness.removedSignals).toEqual(['SIGINT', 'SIGTERM'])
    })
})
