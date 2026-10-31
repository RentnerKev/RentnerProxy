import { describe, expect, test } from 'bun:test'
import {
    createBackupAgentHandler,
    reconcileBackupControl,
    recoverManagedBackupState,
    removeRetainedBackup,
} from '../../../../../../docker/production/backups/agent.ts'
import { createManagedBackupEngine } from '../../../../../../scripts/backup/managed-jobs.ts'

const actorId = '00000000-0000-4000-8000-000000000001'
const requestId = '00000000-0000-4000-8000-000000000002'
async function fixture() {
    let counter = 10
    const engine = await createManagedBackupEngine({
        read: async () => null,
        write: async () => {},
        now: () => 0,
        id: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}`,
        source: () => ({
            imageId: null,
            revision: null,
            version: 'development',
            buildSha256: 'a'.repeat(64),
        }),
        execute: async () => {
            throw new Error('not executed from HTTP')
        },
        verify: async () => false,
        remove: async () => {},
    })
    return { engine, handle: createBackupAgentHandler(engine) }
}
function request(method: string, path: string, body?: unknown) {
    return new Request('http://localhost' + path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
}

describe('private root backup agent routes', () => {
    test('status returns bounded contract and exact route/method allowlist', async () => {
        const { handle } = await fixture()
        expect((await handle(request('GET', '/status'))).status).toBe(200)
        expect((await handle(request('POST', '/status'))).status).toBe(404)
        expect((await handle(request('GET', '/start'))).status).toBe(404)
        expect((await handle(request('POST', '/start/'))).status).toBe(404)
        expect((await handle(request('DELETE', '/config'))).status).toBe(404)
    })

    test('rejects malformed, oversized, unknown-field, and invalid actor requests before admission', async () => {
        const { handle, engine } = await fixture()
        expect(
            (
                await handle(
                    new Request('http://localhost/start', { method: 'POST', body: '{broken' }),
                )
            ).status,
        ).toBe(400)
        expect(
            (await handle(request('POST', '/start', { actorId, requestId, output: '/arbitrary' })))
                .status,
        ).toBe(400)
        expect(
            (await handle(request('POST', '/start', { actorId: 'invalid', requestId }))).status,
        ).toBe(400)
        expect(
            (
                await handle(
                    request('POST', '/start', { actorId, requestId, padding: 'a'.repeat(2048) }),
                )
            ).status,
        ).toBe(400)
        expect((await engine.status()).jobs).toHaveLength(0)
    })

    test('returns durable queued admission, handles replay, and reports busy without executing exports', async () => {
        const { handle } = await fixture()
        const first = await handle(request('POST', '/start', { actorId, requestId }))
        expect(first.status).toBe(200)
        const status = (await first.json()) as { jobs: { state: string }[] }
        expect(status.jobs[0]?.state).toBe('queued')
        expect((await handle(request('POST', '/start', { actorId, requestId }))).status).toBe(200)
        const busy = await handle(
            request('POST', '/start', {
                actorId,
                requestId: '00000000-0000-4000-8000-000000000003',
            }),
        )
        expect(busy.status).toBe(409)
        expect(await busy.json()).toEqual({ error: 'busy' })
    })

    test('validates configuration and maps revision conflict to safe API response', async () => {
        const { handle } = await fixture()
        const config = {
            actorId,
            requestId,
            expectedRevision: 0,
            enabled: true,
            intervalHours: 24,
            retentionCount: 7,
        }
        expect((await handle(request('PUT', '/config', config))).status).toBe(200)
        expect(
            (await handle(request('PUT', '/config', { ...config, retentionCount: 100 }))).status,
        ).toBe(400)
        const conflict = await handle(
            request('PUT', '/config', {
                ...config,
                requestId: '00000000-0000-4000-8000-000000000003',
            }),
        )
        expect(conflict.status).toBe(409)
        expect(await conflict.json()).toEqual({ error: 'conflict' })
    })

    test('startup clears interrupted active work without a result and preserves the published artifact', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'interrupted'
        job.error = 'interrupted'
        job.artifact = { id: job.id, metadataSha256: 'b'.repeat(64), bytes: 100 }
        const removed: string[] = []
        await reconcileBackupControl([job], 'startup', {
            read: async (path) => (path.endsWith('active.json') ? { id: job.id } : null),
            remove: async (path) => {
                removed.push(path)
            },
        })
        expect(removed).toHaveLength(1)
        expect(removed[0]).toEndWith('active.json')
        expect(job.state).toBe('interrupted')
        expect(job.artifact?.id).toBe(job.id)
    })

    test('runtime cannot remove an active marker without the correlated lifecycle result', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'interrupted'
        const removed: string[] = []
        await expect(
            reconcileBackupControl([job], 'runtime', {
                read: async (path) => (path.endsWith('active.json') ? { id: job.id } : null),
                remove: async (path) => {
                    removed.push(path)
                },
            }),
        ).rejects.toThrow('backup lifecycle incomplete')
        expect(removed).toEqual([])
        await expect(
            reconcileBackupControl([job], 'runtime', {
                read: async (path) =>
                    path.endsWith('active.json')
                        ? { id: job.id }
                        : { id: requestId, success: true },
                remove: async (path) => {
                    removed.push(path)
                },
            }),
        ).rejects.toThrow('backup lifecycle mismatch')
        expect(removed).toEqual([])
    })
    test('already removed canonical retained jobs are idempotent but partial damage is rejected', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'succeeded'
        job.retained = true
        job.artifact = { id: job.id, metadataSha256: 'b'.repeat(64), bytes: 100 }
        const touched: string[] = []
        const io = {
            exists: async () => false,
            inspect: async (id: string) => {
                touched.push(id)
                return id
            },
            remove: async (directory: string) => {
                touched.push(directory)
            },
            sync: async () => {
                touched.push('sync')
            },
        }
        await removeRetainedBackup(job, io)
        expect(touched).toEqual([])
        io.exists = async () => true
        io.inspect = async () => {
            throw Object.assign(new Error('missing child'), { code: 'ENOENT' })
        }
        await expect(removeRetainedBackup(job, io)).rejects.toThrow('missing child')
        expect(touched).toEqual([])
    })

    test('startup discovers verified publication identity without promoting interrupted work to success', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        const input = { ...(await engine.status()), version: 1, configurationRequests: [] }
        input.jobs[0]!.state = 'running'
        const artifact = { id: job.id, metadataSha256: 'b'.repeat(64), bytes: 100 }
        const recovered = await recoverManagedBackupState(input, async () => artifact)
        expect(recovered.jobs[0]?.artifact).toEqual(artifact)
        expect(recovered.jobs[0]?.state).toBe('running')
        expect(recovered.jobs[0]?.retained).toBe(false)
        expect(input.jobs[0]?.artifact).toBeNull()
        const missing = await recoverManagedBackupState(input, async () => {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        })
        expect(missing.jobs[0]?.artifact).toBeNull()
        const invalid = await recoverManagedBackupState(input, async () => {
            throw new Error('checksum mismatch')
        })
        expect(invalid.jobs[0]?.artifact).toBeNull()
        await expect(
            recoverManagedBackupState(input, async () => {
                throw Object.assign(new Error('IO failed'), { code: 'EIO' })
            }),
        ).rejects.toThrow('IO failed')
    })
    test('startup reconciles graceful-stop recovery failure without a result while runtime refuses it', async () => {
        const { engine } = await fixture()
        const job = await engine.start({ actorId, requestId })
        job.state = 'failed'
        job.error = 'recovery_failed'
        job.startedAt = 0
        job.finishedAt = 100
        job.durationMs = 100
        const removed: string[] = []
        const io = {
            read: async (path: string) => (path.endsWith('active.json') ? { id: job.id } : null),
            remove: async (path: string) => {
                removed.push(path)
            },
        }
        await expect(reconcileBackupControl([job], 'runtime', io)).rejects.toThrow(
            'backup lifecycle incomplete',
        )
        expect(removed).toEqual([])
        await reconcileBackupControl([job], 'startup', io)
        expect(removed).toHaveLength(1)
        expect(removed[0]).toEndWith('active.json')
        expect(job).toMatchObject({
            state: 'failed',
            error: 'recovery_failed',
            artifact: null,
            retained: false,
        })
    })
    test('sanitizes internal persistence failures', async () => {
        const { engine } = await fixture()
        engine.start = async () => {
            throw new Error('sensitive internal details')
        }
        const response = await createBackupAgentHandler(engine)(
            request('POST', '/start', { actorId, requestId }),
        )
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ error: 'unavailable' })
    })
})
