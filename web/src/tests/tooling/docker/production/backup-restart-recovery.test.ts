import { beforeEach, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import type {
    ManagedBackupMaintenance,
    ManagedBackupState,
} from '../../../../lib/Backups/Types/backups.types.ts'

const controlRoot = '/isolated-root-control'
const stateFile = '/isolated-root-state/jobs.json'
const proofFile = join(controlRoot, 'restore-restarted.json')
const files = new Map<string, unknown>()
let readError: Error | null = null
mock.module('../../../../../../docker/production/backups/storage.ts', () => ({
    controlRoot,
    stateFile,
    readPrivateJson: async (path: string) => {
        if (readError) throw readError
        if (!files.has(path)) throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' })
        return structuredClone(files.get(path))
    },
    writePrivateJson: async (path: string, value: unknown) => {
        files.set(path, structuredClone(value))
    },
}))
const { canConfirmRestartedRestore, confirmRestartedRestore, hasRestartedRestoreProof } =
    await import('../../../../../../docker/production/backups/restart-recovery.ts')

function operation(): ManagedBackupMaintenance {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        requestId: '00000000-0000-4000-8000-000000000002',
        actorId: '00000000-0000-4000-8000-000000000003',
        actorName: null,
        artifactId: '00000000-0000-4000-8000-000000000004',
        metadataSha256: 'a'.repeat(64),
        operation: 'restore',
        state: 'failed',
        phase: 'restarting',
        progressPercent: 90,
        requestedAt: 0,
        startedAt: 1,
        finishedAt: 2,
        error: 'recovery_failed',
    }
}

function state(maintenance: ManagedBackupMaintenance): ManagedBackupState {
    return {
        version: 1,
        storeId: maintenance.id,
        configuration: {
            revision: 0,
            enabled: false,
            intervalHours: 24,
            retentionCount: 7,
            nextRunAt: null,
        },
        jobs: [],
        configurationRequests: [],
        auditEvents: [],
        maintenance,
    }
}

beforeEach(() => {
    files.clear()
    readError = null
})

test('root readiness proof binds the exact failed final restart and archive digest', async () => {
    const current = operation()
    files.set(stateFile, state(current))
    expect(await hasRestartedRestoreProof(current)).toBe(false)
    await confirmRestartedRestore()
    expect(files.get(proofFile)).toEqual({ id: current.id, metadataSha256: current.metadataSha256 })
    expect(await hasRestartedRestoreProof(current)).toBe(true)
    expect(await hasRestartedRestoreProof({ ...current, metadataSha256: 'b'.repeat(64) })).toBe(
        false,
    )
    expect(await hasRestartedRestoreProof({ ...current, id: current.requestId })).toBe(false)
    expect(await hasRestartedRestoreProof({ ...current, state: 'interrupted' })).toBe(true)
})

test.each([
    { phase: 'database', progressPercent: 30 },
    { phase: 'secrets', progressPercent: 85 },
    { progressPercent: 89 },
    { state: 'running' },
    { state: 'succeeded', phase: 'complete', progressPercent: 100 },
    { operation: 'delete' },
    { metadataSha256: null },
] satisfies Partial<ManagedBackupMaintenance>[])(
    'never certifies an incomplete replacement or unrelated lifecycle: %j',
    async (change) => {
        const current = { ...operation(), ...change }
        files.set(stateFile, state(current))
        expect(canConfirmRestartedRestore(current)).toBe(false)
        await confirmRestartedRestore()
        expect(files.has(proofFile)).toBe(false)
        expect(await hasRestartedRestoreProof(current)).toBe(false)
    },
)

test('missing state is a no-op and unsafe or malformed state fails closed', async () => {
    await confirmRestartedRestore()
    expect(canConfirmRestartedRestore(null)).toBe(false)
    expect(canConfirmRestartedRestore(undefined)).toBe(false)
    files.set(stateFile, { invalid: true })
    await expect(confirmRestartedRestore()).rejects.toThrow()
    files.set(proofFile, { ...operation() })
    await expect(hasRestartedRestoreProof(operation())).rejects.toThrow()
    readError = new Error('unsafe fixture ownership')
    await expect(confirmRestartedRestore()).rejects.toThrow('unsafe fixture ownership')
    await expect(hasRestartedRestoreProof(operation())).rejects.toThrow('unsafe fixture ownership')
})
