import {
    createProxyRuntimeSnapshot,
    MAX_RUNTIME_PAYLOAD_BYTES,
} from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'
import type {
    ProxyHostSummary,
    ProxyHostAccessPolicy,
} from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import { describe, expect, mock, spyOn, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { ProxyHostDomainError } from '@/server/Admin/ProxyHostManagement/proxy-hosts.errors.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'
import { createBulkHostServices } from '@/server/Admin/HostBulkActions/bulk-hosts.service.ts'
import type {
    BulkHost,
    BulkHostDependencies,
} from '@/server/Admin/HostBulkActions/Types/bulk-hosts-service.types.ts'
import type {
    BulkHostAction,
    BulkHostResult,
} from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import { assignHostTags, emptyHostTagState } from '@/lib/HostTags/hostTags.ts'
import type { HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import { bulkHostTagIds } from '@/lib/HostBulkActions/bulkHostActions.ts'
import { auditEventInputSchema } from '@/features/Admin/AuditLogs/validation.ts'
import {
    bulkHostApplySchema,
    bulkHostPreviewSchema,
} from '@/features/Admin/HostBulkActions/validation.ts'
import { BULK_HOST_LIMITS } from '@/config/bulk-hosts.config.ts'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
function host(value: number, overrides: Partial<BulkHost> = {}): BulkHost {
    return {
        id: id(value),
        domains: [`host${value}.example.test`],
        enabled: true,
        certificateId: null,
        forceHttps: false,
        accessPolicyId: null,
        forwardScheme: 'http',
        forwardHost: '127.0.0.1',
        forwardPort: 8080,
        verifyUpstreamTls: true,
        upstreamTlsServerName: null,
        trustedCaId: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...overrides,
    }
}
function appliedInput(preview: BulkHostResult, action: BulkHostAction = { type: 'disable' }) {
    return {
        kind: 'proxy' as const,
        action,
        hosts: preview.rows.flatMap((row) =>
            row.version ? [{ id: row.id, version: row.version }] : [],
        ),
    }
}
function fixture(initial: BulkHost[] = [host(1), host(2)]) {
    let permissions: PermissionKey[] = Object.values(PERMISSIONS)
    let hosts = structuredClone(initial)
    let tags = emptyHostTagState()
    let now = 0
    const transaction = {} as AuthTransaction
    const actor = {
        id: id(99),
        permissions,
        roles: [],
        email: 'fixture@example.test',
        displayName: 'Fixture',
        profileImageVersion: null,
        themeMode: 'dark',
        language: 'de',
    } satisfies AuthenticatedUser
    const assertPermission = (permission: PermissionKey) => {
        if (!permissions.includes(permission))
            throw new AuthDomainError('permission_denied', 'Denied')
    }
    const deps: BulkHostDependencies = {
        authorize: mock(async (permission) => {
            assertPermission(permission)
            return actor
        }),
        reauthorize: mock(async (_transaction, _actorId, permission) =>
            assertPermission(permission),
        ),
        transaction: async (run) => {
            const beforeHosts = structuredClone(hosts)
            const beforeTags = structuredClone(tags)
            try {
                return await run(transaction)
            } catch (error) {
                hosts = beforeHosts
                tags = beforeTags
                throw error
            }
        },
        savepoint: async (_transaction, run) => {
            const beforeHosts = structuredClone(hosts)
            const beforeTags = structuredClone(tags)
            try {
                return await run(transaction)
            } catch (error) {
                hosts = beforeHosts
                tags = beforeTags
                throw error
            }
        },
        lock: mock(async () => undefined),
        read: mock(async (_transaction, _kind, ids) =>
            structuredClone(hosts.filter((row) => ids.includes(row.id))),
        ),
        readTags: mock(async () => structuredClone(tags)),
        validate: mock(async () => undefined),
        validateRuntime: mock(async () => undefined),
        write: mock(async (_transaction, _kind, row, action, state) => {
            if (action.type === 'addTags' || action.type === 'removeTags') {
                tags = assignHostTags(state, row.id, bulkHostTagIds(state, row.id, action))
            } else {
                const changes =
                    action.type === 'enable' || action.type === 'disable'
                        ? { enabled: action.type === 'enable' }
                        : action.type === 'certificate'
                          ? { certificateId: action.certificateId }
                          : { accessPolicyId: action.accessPolicyId }
                hosts = hosts.map((current) =>
                    current.id === row.id
                        ? { ...current, ...changes, updatedAt: new Date(10) }
                        : current,
                )
            }
        }),
        audit: mock(async (_transaction, event) => {
            expect(auditEventInputSchema.safeParse(event).success).toBe(true)
        }),
        reconcile: mock(async () => 'applied' as const),
        now: () => now,
    }
    const services = createBulkHostServices(deps)
    const input = (action: BulkHostAction = { type: 'disable' }) => ({
        kind: 'proxy' as const,
        hostIds: initial.map((row) => row.id),
        action,
    })
    return {
        deps,
        services,
        input,
        appliedInput,
        hosts: () => hosts,
        tags: () => tags,
        setTags: (state: HostTagState) => {
            tags = state
        },
        setPermissions: (value: PermissionKey[]) => {
            permissions = value
        },
        setHosts: (value: BulkHost[]) => {
            hosts = value
        },
        setNow: (value: number) => {
            now = value
        },
    }
}

describe('previewed bulk host mutations', () => {
    test('previews without mutation, saves both rows and reconciles once with per-host audits', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        expect(preview.rows.map((row) => row.status)).toEqual(['ready', 'ready'])
        expect(f.deps.write).not.toHaveBeenCalled()
        expect(f.deps.audit).not.toHaveBeenCalled()
        expect(f.deps.lock).not.toHaveBeenCalled()
        const result = await f.services.apply(f.appliedInput(preview))
        expect(result.rows.map((row) => row.status)).toEqual(['applied', 'applied'])
        expect(result.runtimeStatus).toBe('applied')
        expect(f.hosts().every((row) => !row.enabled)).toBe(true)
        expect(f.deps.lock).toHaveBeenCalledTimes(1)
        expect(f.deps.reconcile).toHaveBeenCalledTimes(1)
        expect(f.deps.audit).toHaveBeenCalledTimes(2)
        const events = (f.deps.audit as ReturnType<typeof mock>).mock.calls.map((call) => call[1])
        expect(events[0].metadata.operationId).toBe(events[1].metadata.operationId)
        expect(JSON.stringify(events)).not.toContain('example.test')
        expect(JSON.stringify(events)).not.toContain('127.0.0.1')
    })
    test('replaying an applied batch is harmless and does not reload or audit again', async () => {
        const f = fixture()
        const input = f.appliedInput(await f.services.preview(f.input()))
        await f.services.apply(input)
        expect(
            (await f.services.apply(input)).rows.every((row) => row.status === 'unchanged'),
        ).toBe(true)
        expect(f.deps.write).toHaveBeenCalledTimes(2)
        expect(f.deps.reconcile).toHaveBeenCalledTimes(1)
    })
    test('rejects a stale preview and forged action while applying unaffected rows', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        f.setHosts([host(1, { forwardPort: 9090, updatedAt: new Date(5) }), host(2)])
        const result = await f.services.apply(f.appliedInput(preview))
        expect(result.rows[0]).toMatchObject({ status: 'skipped', reason: 'conflict' })
        expect(result.rows[1]?.status).toBe('applied')
        expect(f.hosts()[0]?.enabled).toBe(true)
        const forged = await f.services.apply(
            f.appliedInput(preview, { type: 'certificate', certificateId: id(88) }),
        )
        expect(forged.rows.every((row) => row.reason === 'conflict')).toBe(true)
    })
    test('checks read and action permissions including directly supplied IDs', async () => {
        const f = fixture()
        f.setPermissions([PERMISSIONS.PROXY_HOSTS_DISABLE])
        await expect(f.services.preview(f.input())).rejects.toMatchObject({
            code: 'permission_denied',
        })
        expect(f.deps.read).not.toHaveBeenCalled()
        f.setPermissions([PERMISSIONS.PROXY_HOSTS_VIEW])
        const preview = await f.services.preview(f.input())
        expect(preview.rows.every((row) => row.reason === 'permission')).toBe(true)
        expect(f.deps.validate).not.toHaveBeenCalled()
    })
    test('permission revocation after preview prevents every write', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        f.setPermissions([PERMISSIONS.PROXY_HOSTS_VIEW])
        const result = await f.services.apply(f.appliedInput(preview))
        expect(result.rows.every((row) => row.reason === 'permission')).toBe(true)
        expect(f.deps.write).not.toHaveBeenCalled()
    })
    test('rechecks authorization after taking the mutation lock', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        spyOn(f.deps, 'lock').mockImplementation(async () => f.setPermissions([]))
        await expect(f.services.apply(f.appliedInput(preview))).rejects.toMatchObject({
            code: 'permission_denied',
        })
        expect(f.deps.write).not.toHaveBeenCalled()
    })
    test('skips discovery-owned managed fields but permits classification', async () => {
        const f = fixture([host(1, { discovery: { state: 'managed' } }), host(2)])
        expect((await f.services.preview(f.input())).rows[0]).toMatchObject({
            status: 'skipped',
            reason: 'discovery',
        })
        f.setTags({ ...emptyHostTagState(), tags: [{ id: id(8), name: 'Infra' }] })
        const action = { type: 'addTags', tagIds: [id(8)] } as const
        const preview = await f.services.preview(f.input({ ...action, tagIds: [...action.tagIds] }))
        expect(preview.rows.every((row) => row.status === 'ready')).toBe(true)
    })
    test('preserves every classification write without reconciling the runtime', async () => {
        const f = fixture()
        f.setTags({
            ...emptyHostTagState(),
            tags: [
                { id: id(8), name: 'Infra' },
                { id: id(9), name: 'Private' },
            ],
            assignments: { [id(1)]: [id(9)] },
        })
        const action: BulkHostAction = { type: 'addTags', tagIds: [id(8)] }
        const preview = await f.services.preview(f.input(action))
        const result = await f.services.apply(f.appliedInput(preview, action))
        expect(result.rows.every((row) => row.status === 'applied')).toBe(true)
        expect(f.tags().assignments).toEqual({ [id(1)]: [id(8), id(9)], [id(2)]: [id(8)] })
        expect(f.deps.reconcile).not.toHaveBeenCalled()
        const removal: BulkHostAction = { type: 'removeTags', tagIds: [id(8)] }
        await f.services.apply(f.appliedInput(await f.services.preview(f.input(removal)), removal))
        expect(f.tags().assignments).toEqual({ [id(1)]: [id(9)] })
    })
    test('a tag edit after preview is detected without overwriting it', async () => {
        const f = fixture()
        const state = {
            ...emptyHostTagState(),
            tags: [
                { id: id(8), name: 'Infra' },
                { id: id(9), name: 'Private' },
            ],
        }
        f.setTags(state)
        const action: BulkHostAction = { type: 'addTags', tagIds: [id(8)] }
        const preview = await f.services.preview(f.input(action))
        f.setTags(assignHostTags(state, id(1), [id(9)]))
        const result = await f.services.apply(f.appliedInput(preview, action))
        expect(result.rows[0]?.reason).toBe('conflict')
        expect(f.tags().assignments[id(1)]).toEqual([id(9)])
        expect(f.tags().assignments[id(2)]).toEqual([id(8)])
    })
    test('invalid, disappeared and unsupported targets do not stop other rows', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        f.setHosts([host(2)])
        expect(
            (await f.services.apply(f.appliedInput(preview))).rows.map((row) => row.status),
        ).toEqual(['skipped', 'applied'])
        const redirects = fixture([
            {
                id: id(1),
                domains: ['redirect.example.test'],
                destination: 'https://example.test',
                statusCode: 302,
                preserveRequestUri: true,
                enabled: true,
                certificateId: null,
                createdAt: new Date(0),
                updatedAt: new Date(0),
            },
        ])
        const result = await redirects.services.preview({
            ...redirects.input({ type: 'accessPolicy', accessPolicyId: id(8) }),
            kind: 'redirect',
        })
        expect(result.rows[0]?.reason).toBe('unsupported')
    })
    test('validates certificate coverage in preview and revalidates before saving', async () => {
        const f = fixture()
        const action: BulkHostAction = { type: 'certificate', certificateId: id(8) }
        const preview = await f.services.preview(f.input(action))
        expect(f.deps.validate).toHaveBeenCalledTimes(2)
        spyOn(f.deps, 'validate').mockImplementation(async (_transaction, row) => {
            if (row.id === id(1)) throw new CertificateDomainError('domain_mismatch')
        })
        const result = await f.services.apply(f.appliedInput(preview, action))
        expect(result.rows[0]).toMatchObject({ status: 'skipped', reason: 'invalid' })
        expect(result.rows[1]?.status).toBe('applied')
    })
    test('a discovery ownership race is rechecked by the authoritative validator', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        spyOn(f.deps, 'validate').mockRejectedValue(
            new ProxyHostDomainError('discovery_managed', 'Managed'),
        )
        expect(
            (await f.services.apply(f.appliedInput(preview))).rows.every(
                (row) => row.reason === 'discovery',
            ),
        ).toBe(true)
        expect(f.deps.write).not.toHaveBeenCalled()
    })
    test('rolls back only the failed savepoint including its audit and preserves safe errors', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        spyOn(f.deps, 'audit').mockImplementation(async (_transaction, event) => {
            if (event.targetId === id(1)) throw new Error('private credential must not be exposed')
        })
        const result = await f.services.apply(f.appliedInput(preview))
        expect(result.rows.map((row) => row.status)).toEqual(['failed', 'applied'])
        expect(f.hosts().map((row) => row.enabled)).toEqual([true, false])
        expect(JSON.stringify(result)).not.toContain('credential')
        expect(f.deps.reconcile).toHaveBeenCalledTimes(1)
    })
    test('runtime failures retain saved desired state and report pending', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        spyOn(f.deps, 'reconcile').mockRejectedValue(new Error('controller offline'))
        const result = await f.services.apply(f.appliedInput(preview))
        expect(result.runtimeStatus).toBe('pending')
        expect(result.rows.every((row) => row.status === 'applied')).toBe(true)
        expect(f.hosts().every((row) => !row.enabled)).toBe(true)
    })
    test('stops a batch at its deadline and reports every unattempted row for retry', async () => {
        const f = fixture()
        const preview = await f.services.preview(f.input())
        spyOn(f.deps, 'validate').mockImplementation(async () => {
            f.setNow(BULK_HOST_LIMITS.durationMs)
        })
        const result = await f.services.apply(f.appliedInput(preview))
        expect(result.rows.map((row) => row.status)).toEqual(['applied', 'failed'])
        expect(result.rows[1]?.reason).toBe('timeout')
    })
    test('rejects duplicates, excessive or forged selections and unsupported actions', () => {
        const f = fixture()
        expect(
            bulkHostPreviewSchema.safeParse({ ...f.input(), hostIds: [id(1), id(1)] }).success,
        ).toBe(false)
        expect(
            bulkHostPreviewSchema.safeParse({
                ...f.input(),
                hostIds: Array.from({ length: 51 }, (_, index) => id(index)),
            }).success,
        ).toBe(false)
        expect(
            bulkHostPreviewSchema.safeParse({ ...f.input(), action: { type: 'delete' } }).success,
        ).toBe(false)
        expect(
            bulkHostApplySchema.safeParse({
                kind: 'proxy',
                action: { type: 'disable' },
                hosts: [{ id: id(1), version: 'forged' }],
            }).success,
        ).toBe(false)
    })
})

function snapshotFor(hosts: BulkHost[], policy?: ProxyHostAccessPolicy) {
    return createProxyRuntimeSnapshot(
        hosts
            .filter((row): row is ProxyHostSummary => 'forwardHost' in row)
            .map((row) =>
                Object.assign(
                    {
                        id: row.id,
                        domains: row.domains,
                        enabled: row.enabled,
                        forwardScheme: row.forwardScheme,
                        forwardHost: row.forwardHost,
                        forwardPort: row.forwardPort,
                    },
                    policy && row.accessPolicyId === policy.id ? { accessPolicy: policy } : {},
                ),
            ),
    )
}

describe('combined desired-state validation inside each bulk savepoint', () => {
    test('repairs an over-limit legacy state by disabling hosts across intermediate invalid states', async () => {
        const initial = Array.from({ length: 1002 }, (_, index) => host(index + 1))
        const f = fixture(initial)
        const snapshot = spyOn(f.deps, 'validateRuntime').mockImplementation(async () =>
            snapshotFor(f.hosts()),
        )
        expect(() => snapshotFor(f.hosts())).toThrow()
        const preview = await f.services.preview({
            kind: 'proxy',
            action: { type: 'disable' },
            hostIds: initial.slice(1000).map((row) => row.id),
        })
        const result = await f.services.apply(appliedInput(preview))
        expect(result.rows.map((row) => row.status)).toEqual(['applied', 'applied'])
        expect(snapshotFor(f.hosts()).proxyHosts).toHaveLength(1000)
        expect(
            f
                .hosts()
                .slice(1000)
                .every((row) => !row.enabled),
        ).toBe(true)
        expect(snapshot).not.toHaveBeenCalled()
        expect(f.deps.lock).toHaveBeenCalledTimes(1)
        expect(f.deps.validate).toHaveBeenCalledTimes(4)
        expect(f.deps.audit).toHaveBeenCalledTimes(2)
        expect(f.deps.reconcile).toHaveBeenCalledTimes(1)
        expect(result.runtimeStatus).toBe('applied')
    })

    test('rejects the 1001st active host while preserving the earlier valid enable and its audit', async () => {
        const initial = Array.from({ length: 1001 }, (_, index) =>
            host(index + 1, { enabled: index < 999 }),
        )
        const f = fixture(initial)
        const action = { type: 'enable' } as const
        const snapshot = spyOn(f.deps, 'validateRuntime').mockImplementation(async () =>
            snapshotFor(f.hosts()),
        )
        expect(snapshotFor(f.hosts()).proxyHosts).toHaveLength(999)
        const preview = await f.services.preview({
            kind: 'proxy',
            action,
            hostIds: initial.slice(999).map((row) => row.id),
        })
        expect(preview.rows.map((row) => row.status)).toEqual(['ready', 'ready'])
        expect(f.deps.write).not.toHaveBeenCalled()
        expect(snapshot).not.toHaveBeenCalled()
        const result = await f.services.apply(appliedInput(preview, action))
        expect(result.rows.map((row) => [row.status, row.reason])).toEqual([
            ['applied', undefined],
            ['skipped', 'invalid'],
        ])
        expect(snapshotFor(f.hosts()).proxyHosts).toHaveLength(1000)
        expect(f.hosts()[1000]?.enabled).toBe(false)
        expect(f.deps.audit).toHaveBeenCalledTimes(1)
        expect(snapshot).toHaveBeenCalledTimes(2)
        expect(f.deps.reconcile).toHaveBeenCalledTimes(1)
        expect(result.runtimeStatus).toBe('applied')
    })

    test('rejects a policy assignment crossing the aggregate payload limit without undoing the preceding valid row', async () => {
        const policy: ProxyHostAccessPolicy = {
            id: Bun.randomUUIDv7(),
            mode: 'authenticated',
            combination: null,
            basicAuth: {
                accounts: Array.from({ length: 32 }, (_, index) => ({
                    username: ('user' + String(index).padStart(2, '0')).padEnd(64, 'x'),
                    passwordHash:
                        '$argon2id$v=19$m=47104,t=1,p=1$' + 'A'.repeat(43) + '$' + 'A'.repeat(43),
                })),
            },
        }
        const initial = Array.from({ length: 1000 }, (_, index) =>
            host(index + 1, {
                domains: Array.from({ length: 50 }, (_alias, alias) =>
                    [
                        'host' + index + '-d' + alias,
                        'a'.repeat(63),
                        'b'.repeat(63),
                        'c'.repeat(63),
                        'example',
                        'test',
                    ].join('.'),
                ),
            }),
        )
        const { revision: _revision, ...plain } = snapshotFor(initial)
        const capacity = Math.floor(
            (MAX_RUNTIME_PAYLOAD_BYTES - 100 - Buffer.byteLength(JSON.stringify(plain))) /
                Buffer.byteLength(',"accessPolicy":' + JSON.stringify(policy)),
        )
        expect(capacity).toBeGreaterThan(1)
        expect(capacity).toBeLessThan(999)
        const alreadyAssigned = capacity - 1
        const configured = initial.map((row, index) =>
            index < alreadyAssigned ? Object.assign({}, row, { accessPolicyId: policy.id }) : row,
        )
        const f = fixture(configured)
        spyOn(f.deps, 'validateRuntime').mockImplementation(async () =>
            snapshotFor(f.hosts(), policy),
        )
        expect(() => snapshotFor(f.hosts(), policy)).not.toThrow()
        const action = { type: 'accessPolicy', accessPolicyId: policy.id } as const
        const preview = await f.services.preview({
            kind: 'proxy',
            action,
            hostIds: initial.slice(alreadyAssigned, alreadyAssigned + 2).map((row) => row.id),
        })
        const result = await f.services.apply(appliedInput(preview, action))
        expect(result.rows.map((row) => [row.status, row.reason])).toEqual([
            ['applied', undefined],
            ['skipped', 'invalid'],
        ])
        expect(() => snapshotFor(f.hosts(), policy)).not.toThrow()
        expect(f.hosts()[alreadyAssigned]).toMatchObject({ accessPolicyId: policy.id })
        expect(f.hosts()[alreadyAssigned + 1]).toMatchObject({ accessPolicyId: null })
        expect(f.deps.audit).toHaveBeenCalledTimes(1)
        expect(f.deps.reconcile).toHaveBeenCalledTimes(1)
    })

    test('does not validate or reload the runtime when changing only tags', async () => {
        const f = fixture()
        const tagId = id(100)
        f.setTags({
            version: 1,
            revision: 0,
            tags: [{ id: tagId, name: 'Public' }],
            assignments: {},
        })
        const action: BulkHostAction = { type: 'addTags', tagIds: [tagId] }
        const preview = await f.services.preview(f.input(action))
        await f.services.apply(appliedInput(preview, action))
        expect(f.deps.validateRuntime).not.toHaveBeenCalled()
        expect(f.deps.reconcile).not.toHaveBeenCalled()
    })
})
