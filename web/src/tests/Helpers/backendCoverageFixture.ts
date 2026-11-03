import { randomUUID } from 'node:crypto'
import { test } from 'bun:test'
import { createServerEntry } from '@tanstack/react-start/server-entry'
import { eq, inArray } from 'drizzle-orm'
import { SESSION_COOKIE_NAME } from '@/config/auth.config.ts'
import { PERMISSIONS, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import { auditEvents, permissions, rolePermissions, roles, userRoles, users } from '@/db/schema.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { createSessionService } from '@/server/Auth/Access/sessions.service.ts'
import { ensureAuthorizationRegistryInTransaction } from '@/server/Auth/Access/registry.service.ts'
import { getDatabaseUrl } from '@/server/env.server.ts'

const requested = process.env.RENTNERPROXY_DATABASE_INTEGRATION === '1'
const url = getDatabaseUrl()
const isolated =
    url !== null &&
    new URL(url).hostname === '127.0.0.1' &&
    new URL(url).pathname === '/rentnerproxy_upstream_test'
if (requested && !isolated)
    throw new Error('Backend coverage tests require the dedicated loopback test database')
export const integrationTest = requested && isolated ? test : test.skip
export const backendCoverageEnabled = requested && isolated
const actorIds: string[] = []
const roleIds: string[] = []
export const database = getAuthDatabase()
export function ownRole(id: string) {
    roleIds.push(id)
}
export async function initializeBackendRegistry() {
    await database.transaction(ensureAuthorizationRegistryInTransaction)
}
export async function createBackendActor(keys?: readonly PermissionKey[]): Promise<string> {
    const id = Bun.randomUUIDv7()
    await database.insert(users).values({
        id,
        email: `${id}@backend-coverage.invalid`,
        displayName: 'Backend coverage fixture',
        status: 'active',
        emailVerifiedAt: new Date(),
    })
    actorIds.push(id)
    let roleId: string
    if (keys) {
        roleId = randomUUID()
        await database
            .insert(roles)
            .values({ id: roleId, key: `coverage-${roleId}`, name: 'Coverage actor' })
        roleIds.push(roleId)
        const selected = await database
            .select({ id: permissions.id })
            .from(permissions)
            .where(inArray(permissions.key, [...new Set([PERMISSIONS.APP_ACCESS, ...keys])]))
        await database
            .insert(rolePermissions)
            .values(selected.map((permission) => ({ roleId, permissionId: permission.id })))
    } else {
        const [owner] = await database
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.OWNER))
        if (!owner) throw new Error('Owner fixture role unavailable')
        roleId = owner.id
    }
    await database.insert(userRoles).values({ userId: id, roleId })
    return id
}
export async function asBackendActor<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const session = await createSessionService(id)
    let outcome: { value: T } | { error: unknown } | undefined
    const handler = createServerEntry({
        fetch: async () => {
            try {
                outcome = { value: await operation() }
            } catch (error) {
                outcome = { error }
            }
            return new Response(null, { status: 204 })
        },
    }).fetch
    await handler(
        new Request('http://localhost/', {
            headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
        }),
        {},
    )
    if (!outcome) throw new Error('Request fixture did not execute')
    if ('error' in outcome) throw outcome.error
    return outcome.value
}
export async function cleanupBackendCoverage() {
    if (actorIds.length) {
        await database.delete(auditEvents).where(inArray(auditEvents.actorUserId, actorIds))
        await database.delete(users).where(inArray(users.id, actorIds.splice(0)))
    }
    if (roleIds.length) {
        await database.delete(auditEvents).where(inArray(auditEvents.targetId, roleIds))
        await database.delete(roles).where(inArray(roles.id, roleIds.splice(0)))
    }
}
