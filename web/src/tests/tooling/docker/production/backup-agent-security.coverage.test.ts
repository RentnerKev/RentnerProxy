import { describe, expect, test } from 'bun:test'
import { createBackupAgentHandler } from '../../../../../../docker/production/backups/agent.ts'
import {
    createManagedBackupEngine,
    ManagedBackupError,
} from '../../../../../../scripts/backup/managed-jobs.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
const configuration = {
    actorId,
    requestId,
    expectedRevision: 0,
    enabled: false,
    endpoint: '',
    region: '',
    bucket: '',
    prefix: '',
}

async function fixture() {
    let sequence = 10
    let failure: unknown
    const changes: unknown[] = []
    const engine = await createManagedBackupEngine({
        read: async () => null,
        write: async () => {},
        now: () => 0,
        id: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
        source: () => ({
            imageId: null,
            revision: null,
            version: 'development',
            buildSha256: 'a'.repeat(64),
        }),
        execute: async () => {
            throw new Error('HTTP must never execute backups')
        },
        verify: async () => false,
        remove: async () => {},
        offHostAudit: { pending: async () => null, acknowledge: async () => {} },
    })
    const offHost = {
        status: () => ({ enabled: false }),
        configure: async (input: unknown) => {
            if (failure) throw failure
            changes.push(input)
        },
    } as unknown as NonNullable<Parameters<typeof createBackupAgentHandler>[1]>
    return {
        engine,
        changes,
        handle: createBackupAgentHandler(engine, offHost),
        fail: (error: unknown) => {
            failure = error
        },
    }
}

describe('private backup agent HTTP validation and failure boundaries', () => {
    test('serializes validated off-host configuration through the engine and never starts a backup', async () => {
        const context = await fixture()
        const response = await context.handle(
            new Request('http://localhost/off-host', {
                method: 'PUT',
                body: JSON.stringify(configuration),
            }),
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ jobs: [], offHost: { enabled: false } })
        expect(context.changes).toEqual([configuration])
        expect((await context.engine.status()).jobs).toEqual([])
    })

    test.each([
        'busy',
        'revision_conflict',
        'capacity',
        'artifact_invalid',
        'recovery_failed',
    ] as const)('sanitizes engine error %s at the configuration boundary', async (code) => {
        const context = await fixture()
        context.fail(new ManagedBackupError(code))
        const response = await context.handle(
            new Request('http://localhost/off-host', {
                method: 'PUT',
                body: JSON.stringify(configuration),
            }),
        )
        expect(response.status).toBe(code === 'recovery_failed' ? 503 : 409)
        expect(await response.json()).toEqual({
            error:
                code === 'busy' ? 'busy' : code === 'recovery_failed' ? 'unavailable' : 'conflict',
        })
        expect(context.changes).toEqual([])
    })

    test('rejects missing, oversized, and locked bodies before admitting any operation', async () => {
        const context = await fixture()
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(8193))
            },
            cancel() {
                cancelled = true
                return Promise.reject(new Error('synthetic cancellation failure'))
            },
        })
        expect(
            (
                await context.handle(
                    new Request('http://localhost/off-host', { method: 'PUT', body }),
                )
            ).status,
        ).toBe(400)
        expect(cancelled).toBe(true)
        expect(
            (await context.handle(new Request('http://localhost/start', { method: 'POST' })))
                .status,
        ).toBe(400)
        const locked = new Request('http://localhost/start', { method: 'POST', body: '{}' })
        const reader = locked.body!.getReader()
        try {
            expect((await context.handle(locked)).status).toBe(400)
        } finally {
            reader.releaseLock()
        }
        expect(context.changes).toEqual([])
        expect((await context.engine.status()).jobs).toEqual([])
    })

    test('rejects ambiguous maintenance identities and query-bearing mutation paths', async () => {
        const context = await fixture()
        await Promise.all(
            [
                '/artifacts/invalid/delete',
                '/artifacts/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA/restore',
                `/artifacts/${actorId}/delete?extra=1`,
            ].map(async (path) => {
                const response = await context.handle(
                    new Request('http://localhost' + path, { method: 'POST', body: '{}' }),
                )
                expect(response.status).toBe(400)
                expect(await response.json()).toEqual({ error: 'invalid_input' })
            }),
        )
        const maintenance = await context.handle(new Request('http://localhost/maintenance'))
        expect(await maintenance.json()).toEqual({ maintenance: null })
        expect(
            (await context.handle(new Request('http://localhost/maintenance?extra=1'))).status,
        ).toBe(404)
        expect(context.changes).toEqual([])
    })
})
