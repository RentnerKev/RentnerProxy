import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createServerEntry } from '@tanstack/react-start/server-entry'
import { withFixtureRequest } from '../../../../scripts/lib/request-context.ts'
import { SESSION_COOKIE_NAME } from '../../../../web/src/config/auth.config.ts'
import { SYSTEM_ROLES } from '../../../../web/src/config/permissions.config.ts'
import { roles, userRoles, users } from '../../../../web/src/db/schema.ts'
import { getAuthDatabase } from '../../../../web/src/server/Auth/Core/database.server.ts'
import { ensureAuthorizationRegistryInTransaction } from '../../../../web/src/server/Auth/Access/registry.service.ts'
import { createSessionService } from '../../../../web/src/server/Auth/Access/sessions.service.ts'
import { closeValkeyClient } from '../../../../web/src/server/Valkey/client.server.ts'
import { reconcileProxyConfigurationService } from '../../../../web/src/server/ProxyRuntime/proxy-runtime.service.ts'
import { dockerDiscoveryWorker } from '../../../../web/src/server/Admin/DockerDiscovery/discovery-worker.ts'
import { notificationWorker } from '../../../../web/src/server/Notifications/notification-worker.server.ts'

export async function createBeta2WebContext(runId: string) {
    assert.equal(process.env.RENTNERPROXY_BETA2_INTEGRATION, runId, 'explicit fixture opt-in')
    const url = new URL(process.env.DATABASE_URL ?? '')
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'loopback test DB')
    assert.equal(url.pathname, '/rentnerproxy_beta2_test', 'dedicated disposable database')
    const database = getAuthDatabase()
    try {
        const count = await database.select({ id: users.id }).from(users).limit(1)
        assert.equal(count.length, 0, 'Beta 2 journey requires a newly migrated fixture database')
        await database.transaction(ensureAuthorizationRegistryInTransaction)
        const [actor] = await database
            .insert(users)
            .values({
                displayName: 'Beta 2 fixture owner',
                email: runId + '@beta2.invalid',
                emailVerifiedAt: new Date(),
                status: 'active',
            })
            .returning({ id: users.id })
        const [owner] = await database
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.OWNER))
        assert.ok(actor && owner)
        await database.insert(userRoles).values({ userId: actor.id, roleId: owner.id })
        const session = await createSessionService(actor.id)
        return {
            database,
            actorId: actor.id,
            authorized<T>(operation: () => Promise<T>): Promise<T> {
                return withFixtureRequest(
                    createServerEntry,
                    SESSION_COOKIE_NAME,
                    session.token,
                    operation,
                )
            },
            async close() {
                await Promise.all([dockerDiscoveryWorker.stop(), notificationWorker.stop()])
                await reconcileProxyConfigurationService.stop()
                closeValkeyClient()
                await database.$client.close()
            },
        }
    } catch (error) {
        closeValkeyClient()
        await database.$client.close()
        throw error
    }
}
