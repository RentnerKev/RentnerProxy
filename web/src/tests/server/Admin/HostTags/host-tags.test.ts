import { describe, expect, mock, spyOn, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import { emptyHostTagState } from '@/lib/HostTags/hostTags.ts'
import { DEFAULT_HOST_TAG_COLOR } from '@/config/host-tags.config.ts'
import type { HostKind, HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import { createHostTagServices } from '@/server/Admin/HostTags/host-tags.service.ts'
import type { HostTagDependencies } from '@/server/Admin/HostTags/Types/host-tags-service.types.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { auditEventInputSchema } from '@/features/Admin/AuditLogs/validation.ts'
import { readHostTags } from '@/server/Admin/HostTags/host-tags.storage.server.ts'

const tagId = '00000000-0000-4000-8000-000000000001'
const hostId = '00000000-0000-4000-8000-000000000002'
const actorId = '00000000-0000-4000-8000-000000000003'

function setup(
    initialPermissions: PermissionKey[] = [
        PERMISSIONS.PROXY_HOSTS_VIEW,
        PERMISSIONS.PROXY_HOSTS_UPDATE,
    ],
) {
    let permissions = initialPermissions
    let states: Record<HostKind, HostTagState> = {
        proxy: emptyHostTagState(),
        redirect: emptyHostTagState(),
    }
    let pending = states
    const transaction = {} as AuthTransaction
    const user = (): AuthenticatedUser => ({
        id: actorId,
        permissions,
        roles: [],
        email: 'fixture@example.test',
        displayName: 'Fixture',
        profileImageVersion: null,
        themeMode: 'dark',
        language: 'de',
    })
    const assertPermission = (permission: PermissionKey) => {
        if (!permissions.includes(permission))
            throw new AuthDomainError('permission_denied', 'Denied')
    }
    const dependencies: HostTagDependencies = {
        authorize: mock(async (permission) => {
            assertPermission(permission)
            return user()
        }),
        reauthorize: mock(async (_transaction, _actor, permission) => assertPermission(permission)),
        transaction: async (run) => {
            pending = structuredClone(states)
            const value = await run(transaction)
            states = pending
            return value
        },
        lock: mock(async () => undefined),
        read: mock(async (_transaction: AuthTransaction, kind: HostKind) => pending[kind]),
        write: mock(async (_transaction: AuthTransaction, kind: HostKind, state: HostTagState) => {
            pending[kind] = state
        }),
        hostExists: mock(async (_transaction, _kind, id) => id === hostId),
        audit: mock(async (_transaction, input) => {
            expect(auditEventInputSchema.safeParse(input).success).toBe(true)
        }),
        newId: () => tagId,
    }
    return {
        services: createHostTagServices(dependencies),
        dependencies,
        state: () => states,
        setPermissions: (next: PermissionKey[]) => {
            permissions = next
        },
    }
}

describe('authorized host tag services', () => {
    test('keeps catalog, revisions and metadata private to the permitted host type', async () => {
        const fixture = setup()
        await expect(fixture.services.catalog('redirect')).rejects.toMatchObject({
            code: 'permission_denied',
        })
        expect(fixture.dependencies.read).not.toHaveBeenCalled()
        await fixture.services.mutate({
            kind: 'proxy',
            action: 'create',
            name: 'Infra',
            expectedRevision: 0,
        })
        expect(await fixture.services.catalog('proxy')).toEqual({
            revision: 1,
            tags: [{ id: tagId, name: 'Infra', color: DEFAULT_HOST_TAG_COLOR }],
        })
        expect(fixture.state().redirect).toEqual(emptyHostTagState())
        for (const args of (fixture.dependencies.read as ReturnType<typeof mock>).mock.calls)
            expect(args[1]).toBe('proxy')
    })
    test.each([
        { permissions: [] },
        { permissions: [PERMISSIONS.PROXY_HOSTS_VIEW] },
        { permissions: [PERMISSIONS.PROXY_HOSTS_UPDATE] },
    ])('requires both view and update for mutations: %j', async ({ permissions }) => {
        const fixture = setup([...permissions])
        await expect(
            fixture.services.mutate({
                kind: 'proxy',
                action: 'create',
                name: 'Infra',
                expectedRevision: 0,
            }),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        expect(fixture.dependencies.write).not.toHaveBeenCalled()
        expect(fixture.dependencies.audit).not.toHaveBeenCalled()
    })
    test('rechecks permission inside the transaction before any metadata write', async () => {
        const fixture = setup()
        spyOn(fixture.dependencies, 'lock').mockImplementation(async () =>
            fixture.setPermissions([]),
        )
        await expect(
            fixture.services.mutate({
                kind: 'proxy',
                action: 'create',
                name: 'Infra',
                expectedRevision: 0,
            }),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        expect(fixture.dependencies.write).not.toHaveBeenCalled()
    })
    test('creates, assigns, renames and deletes with safe audits and rejects stale, unknown and forged assignments', async () => {
        const fixture = setup()
        await fixture.services.mutate({
            kind: 'proxy',
            action: 'create',
            name: 'Infra',
            color: '#003366',
            expectedRevision: 0,
        })
        const assignment = {
            kind: 'proxy',
            action: 'assign',
            hostId,
            tagIds: [tagId],
            expectedTagIds: [],
            expectedRevision: 1,
        }
        await expect(
            fixture.services.mutate({ ...assignment, hostId: crypto.randomUUID() }),
        ).rejects.toMatchObject({ code: 'missing' })
        await fixture.services.mutate(assignment)
        await expect(fixture.services.mutate(assignment)).rejects.toMatchObject({
            code: 'conflict',
        })
        await expect(
            fixture.services.mutate({
                ...assignment,
                tagIds: [crypto.randomUUID()],
                expectedTagIds: [tagId],
                expectedRevision: 2,
            }),
        ).rejects.toMatchObject({ code: 'missing' })
        await fixture.services.mutate({
            kind: 'proxy',
            action: 'rename',
            tagId,
            name: 'Büro',
            color: '#ffcc00',
            expectedRevision: 2,
        })
        expect(fixture.state().proxy.assignments[hostId]).toEqual([tagId])
        expect((await fixture.services.catalog('proxy')).tags[0]?.color).toBe('#ffcc00')
        await fixture.services.mutate({
            kind: 'proxy',
            action: 'delete',
            tagId,
            expectedRevision: 3,
        })
        expect(fixture.state().proxy.tags).toEqual([])
        expect(fixture.state().proxy.assignments).toEqual({})
        expect(fixture.dependencies.audit).toHaveBeenCalledTimes(4)
    })
    test('rolls back classification if auditing fails', async () => {
        const fixture = setup()
        spyOn(fixture.dependencies, 'audit').mockImplementation(async () => {
            throw new Error('audit unavailable')
        })
        await expect(
            fixture.services.mutate({
                kind: 'proxy',
                action: 'create',
                name: 'Infra',
                expectedRevision: 0,
            }),
        ).rejects.toThrow('audit unavailable')
        expect(fixture.state().proxy).toEqual(emptyHostTagState())
    })
    test('supports redirect-only management without requiring proxy permissions', async () => {
        const fixture = setup([PERMISSIONS.REDIRECT_HOSTS_VIEW, PERMISSIONS.REDIRECT_HOSTS_UPDATE])
        await fixture.services.mutate({
            kind: 'redirect',
            action: 'create',
            name: 'Infra',
            expectedRevision: 0,
        })
        expect((await fixture.services.catalog('redirect')).tags[0]?.name).toBe('Infra')
        expect(fixture.state().proxy).toEqual(emptyHostTagState())
    })
    test('defaults a database restored from before classification to an empty catalog', async () => {
        const transaction = {
            select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
        } as unknown as AuthTransaction
        expect(await readHostTags(transaction, 'proxy')).toEqual(emptyHostTagState())
        expect(await readHostTags(transaction, 'redirect')).toEqual(emptyHostTagState())
    })
})
