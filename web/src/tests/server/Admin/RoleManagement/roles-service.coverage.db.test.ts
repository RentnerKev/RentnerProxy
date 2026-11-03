import { randomUUID } from 'node:crypto'
import { afterEach, beforeAll, expect } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { auditEvents, permissions, rolePermissions, roles, userRoles } from '@/db/schema.ts'
import {
    createRoleService,
    deleteRoleService,
    listRolesService,
    updateRoleService,
} from '@/server/Admin/RoleManagement/roles.service.ts'
import {
    asBackendActor,
    backendCoverageEnabled,
    cleanupBackendCoverage,
    createBackendActor,
    database,
    initializeBackendRegistry,
    integrationTest,
    ownRole,
} from '@/tests/Helpers/backendCoverageFixture.ts'

beforeAll(async () => {
    if (backendCoverageEnabled) await initializeBackendRegistry()
})
afterEach(async () => {
    if (backendCoverageEnabled) await cleanupBackendCoverage()
})

integrationTest(
    'role lifecycle normalizes values, deduplicates permissions, preserves unchanged grants and audits committed updates',
    async () => {
        const actor = await createBackendActor()
        const key = `coverage-role-${randomUUID()}`
        const role = await asBackendActor(actor, () =>
            createRoleService({
                key: ` ${key.toUpperCase()} `,
                name: '  Auditors  ',
                description: '  Review access  ',
                permissionKeys: [PERMISSIONS.ROLES_VIEW, PERMISSIONS.ROLES_VIEW],
            }),
        )
        ownRole(role.id)
        expect(role).toMatchObject({
            key,
            name: 'Auditors',
            description: 'Review access',
            permissionKeys: [PERMISSIONS.ROLES_VIEW],
        })
        const renamed = await asBackendActor(actor, () =>
            updateRoleService({ roleId: role.id, name: '  Reviewers  ' }),
        )
        expect(renamed.permissionKeys).toEqual([PERMISSIONS.ROLES_VIEW])
        expect(renamed.name).toBe('Reviewers')
        const cleared = await asBackendActor(actor, () =>
            updateRoleService({ roleId: role.id, description: '  Updated  ', permissionKeys: [] }),
        )
        expect(cleared.permissionKeys).toEqual([])
        expect(cleared.description).toBe('Updated')
        const listing = await asBackendActor(actor, listRolesService)
        expect(listing.find((entry) => entry.id === role.id)).toMatchObject({
            permissionKeys: [],
            userCount: 0,
        })
        const audits = await database
            .select()
            .from(auditEvents)
            .where(and(eq(auditEvents.targetId, role.id), eq(auditEvents.result, 'success')))
        expect(audits.map((event) => event.action)).toEqual(['create', 'update', 'update'])
        await asBackendActor(actor, () => deleteRoleService(role.id))
        expect(await database.select().from(roles).where(eq(roles.id, role.id))).toHaveLength(0)
        expect(
            await database
                .select()
                .from(rolePermissions)
                .where(eq(rolePermissions.roleId, role.id)),
        ).toHaveLength(0)
    },
)

integrationTest(
    'invalid role inputs, missing records and reserved system roles are rejected without writes',
    async () => {
        const actor = await createBackendActor()
        const valid = {
            key: `coverage-role-${randomUUID()}`,
            name: 'Role',
            description: '',
            permissionKeys: [],
        }
        const requests = [
            { ...valid, key: '!invalid' },
            { ...valid, name: ' ' },
            { ...valid, name: 'x'.repeat(101) },
            { ...valid, description: 'x'.repeat(1001) },
            { ...valid, key: SYSTEM_ROLES.OWNER },
            { ...valid, permissionKeys: ['unregistered.permission'] },
        ]
        for (const request of requests) {
            // oxlint-disable-next-line no-await-in-loop -- Each rejected request uses an independent authenticated transaction.
            await expect(
                asBackendActor(actor, () => createRoleService(request)),
            ).rejects.toMatchObject({
                code:
                    request.key === SYSTEM_ROLES.OWNER
                        ? 'system_role_immutable'
                        : request.permissionKeys.length
                          ? 'unknown_permission'
                          : 'invalid_input',
            })
        }
        await expect(
            asBackendActor(actor, () => updateRoleService({ roleId: randomUUID() })),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        await expect(
            asBackendActor(actor, () =>
                updateRoleService({ roleId: randomUUID(), name: 'Absent' }),
            ),
        ).rejects.toMatchObject({ code: 'role_not_found' })
        await expect(
            asBackendActor(actor, () => deleteRoleService(randomUUID())),
        ).rejects.toMatchObject({ code: 'role_not_found' })
        const [owner] = await database
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.OWNER))
        if (!owner) throw new Error('Missing system fixture role')
        await expect(
            asBackendActor(actor, () => updateRoleService({ roleId: owner.id, name: 'Changed' })),
        ).rejects.toMatchObject({ code: 'system_role_immutable' })
        await expect(
            asBackendActor(actor, () => deleteRoleService(owner.id)),
        ).rejects.toMatchObject({ code: 'system_role_immutable' })
        expect(await database.select().from(roles).where(eq(roles.key, valid.key))).toHaveLength(0)
    },
)

integrationTest(
    'non-owner assignment cannot escalate permissions and assigned roles cannot be deleted',
    async () => {
        const owner = await createBackendActor()
        const actor = await createBackendActor([
            PERMISSIONS.ROLES_VIEW,
            PERMISSIONS.ROLES_CREATE,
            PERMISSIONS.ROLES_UPDATE,
            PERMISSIONS.ROLES_DELETE,
            PERMISSIONS.ROLES_ASSIGN_PERMISSIONS,
        ])
        const key = `coverage-role-${randomUUID()}`
        await expect(
            asBackendActor(actor, () =>
                createRoleService({
                    key,
                    name: 'Escalation',
                    description: '',
                    permissionKeys: [PERMISSIONS.CERTIFICATES_DELETE],
                }),
            ),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        expect(await database.select().from(roles).where(eq(roles.key, key))).toHaveLength(0)
        const role = await asBackendActor(actor, () =>
            createRoleService({
                key,
                name: 'Limited',
                description: '',
                permissionKeys: [PERMISSIONS.ROLES_VIEW],
            }),
        )
        ownRole(role.id)
        await expect(
            asBackendActor(actor, () =>
                updateRoleService({
                    roleId: role.id,
                    permissionKeys: [PERMISSIONS.CERTIFICATES_DELETE],
                }),
            ),
        ).rejects.toMatchObject({ code: 'permission_denied' })
        const [unchanged] = await database.select().from(roles).where(eq(roles.id, role.id))
        expect(unchanged?.name).toBe('Limited')
        const assignment = await database
            .select({ permissionId: rolePermissions.permissionId })
            .from(rolePermissions)
            .where(eq(rolePermissions.roleId, role.id))
        expect(assignment).toHaveLength(1)
        await database.insert(userRoles).values({ userId: actor, roleId: role.id })
        await expect(asBackendActor(owner, () => deleteRoleService(role.id))).rejects.toMatchObject(
            { code: 'role_in_use' },
        )
        expect(
            (await asBackendActor(owner, listRolesService)).find((entry) => entry.id === role.id)
                ?.userCount,
        ).toBe(1)
    },
)

integrationTest(
    'duplicate role keys and missing permission registry entries fail atomically',
    async () => {
        const actor = await createBackendActor()
        const input = {
            key: `coverage-role-${randomUUID()}`,
            name: 'Original',
            description: '',
            permissionKeys: [],
        }
        const created = await asBackendActor(actor, () => createRoleService(input))
        ownRole(created.id)
        await expect(
            asBackendActor(actor, () => createRoleService({ ...input, name: 'Duplicate' })),
        ).rejects.toMatchObject({ code: 'invalid_input' })
        expect(await database.select().from(roles).where(eq(roles.key, input.key))).toHaveLength(1)
        await database
            .delete(permissions)
            .where(eq(permissions.key, PERMISSIONS.CERTIFICATES_DELETE))
        try {
            await expect(
                asBackendActor(actor, () =>
                    updateRoleService({
                        roleId: created.id,
                        name: 'Must roll back',
                        permissionKeys: [PERMISSIONS.CERTIFICATES_DELETE],
                    }),
                ),
            ).rejects.toMatchObject({ code: 'unknown_permission' })
            const [unchanged] = await database.select().from(roles).where(eq(roles.id, created.id))
            expect(unchanged?.name).toBe('Original')
        } finally {
            await initializeBackendRegistry()
        }
    },
)
