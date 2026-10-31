import { expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createBackupAdminService } from '@/server/Admin/Backups/backups.service.ts'
import type { BackupAdminDependencies } from '@/server/Admin/Backups/Types/backups-service.types.ts'
import type { AuditEventInput } from '@/lib/Admin/AuditLogs/Types/audit-events.types.ts'
import type {
    ManagedBackupStatus,
    ManagedBackupStart,
    ManagedBackupConfigurationUpdate,
} from '@/lib/Backups/Types/backups.types.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const status: ManagedBackupStatus = {
    storeId: requestId,
    configuration: {
        revision: 0,
        enabled: false,
        intervalHours: 24,
        retentionCount: 5,
        nextRunAt: null,
    },
    jobs: [],
    auditEvents: [],
}
const configurationInput = {
    requestId,
    expectedRevision: 0,
    enabled: true,
    intervalHours: 48,
    retentionCount: 7,
}

function fixture(
    failAt?: 'authorize' | 'limit' | 'reauthorize' | 'audit' | 'controller' | 'commit',
) {
    const steps: string[] = []
    const audits: AuditEventInput[] = []
    const controllerInputs: (ManagedBackupStart | ManagedBackupConfigurationUpdate)[] = []
    const failure = new Error(failAt)
    const step = (name: string) => {
        steps.push(name)
        if (name === failAt) throw failure
    }
    const dependencies: BackupAdminDependencies = {
        authorize: async (permission) => {
            step('authorize')
            steps.push(permission)
            return { id: actorId }
        },
        limit: async (id) => {
            expect(id).toBe(actorId)
            step('limit')
        },
        transaction: async (run) => {
            step('transaction')
            const pending: AuditEventInput[] = []
            try {
                const value = await run({
                    authorize: async (id, permission) => {
                        expect(id).toBe(actorId)
                        expect(permission).toBe(PERMISSIONS.BACKUPS_MANAGE)
                        step('reauthorize')
                    },
                    audit: async (event) => {
                        step('audit')
                        pending.push(event)
                    },
                })
                step('commit')
                audits.push(...pending)
                return value
            } catch (error) {
                steps.push('rollback')
                throw error
            }
        },
        controller: {
            status: async () => {
                step('status')
                return status
            },
            start: async (input) => {
                controllerInputs.push(input)
                step('controller')
                return status
            },
            configure: async (input) => {
                controllerInputs.push(input)
                step('controller')
                return status
            },
        },
    }
    return {
        service: createBackupAdminService(dependencies),
        steps,
        audits,
        controllerInputs,
        failure,
    }
}

test('read authorization uses backups.view and cannot query controller when denied', async () => {
    const allowed = fixture()
    expect(await allowed.service.getBackupsStatusService()).toEqual(status)
    expect(allowed.steps).toEqual(['authorize', PERMISSIONS.BACKUPS_VIEW, 'status'])
    const denied = fixture('authorize')
    await expect(denied.service.getBackupsStatusService()).rejects.toBe(denied.failure)
    expect(denied.steps).toEqual(['authorize'])
})

test('manual backup applies manage authorization, rate limit and transactional reauthorization before audit and actor injection', async () => {
    const f = fixture()
    expect(await f.service.requestBackupService({ requestId })).toEqual(status)
    expect(f.steps).toEqual([
        'authorize',
        PERMISSIONS.BACKUPS_MANAGE,
        'limit',
        'transaction',
        'reauthorize',
        'audit',
        'controller',
        'commit',
    ])
    expect(f.controllerInputs).toEqual([{ requestId, actorId }])
    expect(f.audits).toEqual([
        {
            actorUserId: actorId,
            actorKind: 'user',
            action: 'request',
            resource: 'config-export',
            targetId: requestId,
            result: 'success',
            metadata: {},
        },
    ])
})

test('configuration preserves expected revision and validated settings while injecting authenticated actor', async () => {
    const f = fixture()
    await f.service.updateBackupConfigurationService(configurationInput)
    expect(f.controllerInputs).toEqual([{ ...configurationInput, actorId }])
    expect(f.audits[0]).toMatchObject({
        actorUserId: actorId,
        action: 'update',
        resource: 'security-settings',
        targetId: requestId,
    })
})

test.each(['authorize', 'limit', 'reauthorize', 'audit'] as const)(
    '%s failure prevents controller admission and committed audit',
    async (failAt) => {
        const f = fixture(failAt)
        await expect(f.service.requestBackupService({ requestId })).rejects.toBe(f.failure)
        expect(f.controllerInputs).toHaveLength(0)
        expect(f.audits).toHaveLength(0)
        if (failAt === 'limit') expect(f.steps).not.toContain('transaction')
        if (failAt === 'reauthorize') expect(f.steps).not.toContain('audit')
    },
)

test('controller failure rolls back the request audit and is never returned as success', async () => {
    const f = fixture('controller')
    await expect(f.service.requestBackupService({ requestId })).rejects.toBe(f.failure)
    expect(f.audits).toHaveLength(0)
    expect(f.steps.at(-1)).toBe('rollback')
})

test('commit failure remains an error even after the root accepted the request', async () => {
    const f = fixture('commit')
    await expect(f.service.requestBackupService({ requestId })).rejects.toBe(f.failure)
    expect(f.controllerInputs).toEqual([{ requestId, actorId }])
    expect(f.audits).toHaveLength(0)
})

test('invalid or impersonated mutation inputs cannot reach rate limit, audit or controller', async () => {
    const f = fixture()
    await expect(f.service.requestBackupService({ requestId, actorId })).rejects.toMatchObject({
        code: 'invalid_input',
    })
    await expect(
        f.service.updateBackupConfigurationService({ ...configurationInput, retentionCount: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    expect(f.steps).not.toContain('limit')
    expect(f.controllerInputs).toHaveLength(0)
    expect(f.audits).toHaveLength(0)
})
