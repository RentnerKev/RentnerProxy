import { describe, expect, test } from 'bun:test'
import { createHostMonitoringService } from '@/server/HostMonitoring/host-monitoring.service.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

const proxyHostId = '0198d98a-0000-7000-8000-000000000001'

describe('monitoring batch authorization boundary', () => {
    test('VIEW denial prevents all database access', async () => {
        let databaseCalls = 0
        const service = createHostMonitoringService({
            database: () => {
                databaseCalls += 1
                throw new Error('The database must not be opened.')
            },
            requireActor: async () => {
                throw new AuthDomainError('permission_denied', 'Denied')
            },
            rateLimit: async () => undefined,
        })
        await expect(service.getSummary({ proxyHostIds: [proxyHostId] })).rejects.toMatchObject({
            code: 'permission_denied',
        })
        expect(databaseCalls).toBe(0)
    })

    test('invalid batches fail before authorization and database access', async () => {
        let authorizationCalls = 0
        const service = createHostMonitoringService({
            database: () => {
                throw new Error('The database must not be opened.')
            },
            requireActor: async () => {
                authorizationCalls += 1
                return { id: proxyHostId }
            },
            rateLimit: async () => undefined,
        })
        await expect(
            service.getSummary({ proxyHostIds: [proxyHostId, proxyHostId] }),
        ).rejects.toMatchObject({
            code: 'invalid_input',
        })
        expect(authorizationCalls).toBe(0)
    })
})
