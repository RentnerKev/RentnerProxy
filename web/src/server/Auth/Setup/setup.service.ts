import '@tanstack/react-start/server-only'

import { eq, sql } from 'drizzle-orm'

import { FIRST_OWNER_ADVISORY_LOCK_ID } from '../../../config/auth.config'
import { SYSTEM_ROLES } from '../../../config/permissions.config'
import { roles, userRoles, users } from '../../../db/schema'
import { getAuthDatabase } from '../Core/database.server'
import { AuthDomainError } from '../Core/errors.server'
import { normalizeDisplayName, normalizeEmail } from '../Core/identity.server'
import { hashPassword } from '../Core/password.server'
import { ensureAuthorizationRegistryInTransaction } from '../Access/registry.service'
import { parseTrustedManagementOrigin } from '../../../config/management-origin.config'
import { writeManagementOriginInTransaction } from '../../Configuration/management-origin.server'

export type FirstOwnerSetupResult =
    | { readonly success: true; readonly userId: string; readonly email: string }
    | { readonly success: false; readonly code: 'already_initialized' }

export async function setupFirstOwnerService(input: {
    displayName: string
    email: string
    managementOrigin: string
    password: string
}): Promise<FirstOwnerSetupResult> {
    const email = normalizeEmail(input.email)
    const displayName = normalizeDisplayName(input.displayName)
    const passwordHash = await hashPassword(input.password)
    const managementOrigin = parseTrustedManagementOrigin(input.managementOrigin)
    if (!managementOrigin) {
        throw new AuthDomainError(
            'invalid_input',
            'Enter an HTTPS management address (HTTP is allowed only for localhost).',
        )
    }
    const db = getAuthDatabase()

    return db.transaction(async (transaction) => {
        await transaction.execute(
            sql`select pg_advisory_xact_lock(${FIRST_OWNER_ADVISORY_LOCK_ID})`,
        )

        const existingUsers = await transaction.select({ id: users.id }).from(users).limit(1)

        if (existingUsers.length > 0) {
            return { success: false as const, code: 'already_initialized' as const }
        }

        await ensureAuthorizationRegistryInTransaction(transaction)

        const ownerRoleRows = await transaction
            .select({ id: roles.id })
            .from(roles)
            .where(eq(roles.key, SYSTEM_ROLES.OWNER))
            .limit(1)
        const ownerRole = ownerRoleRows.at(0)

        if (!ownerRole) {
            throw new AuthDomainError('service_unavailable', 'Owner role is unavailable.')
        }

        const userRows = await transaction
            .insert(users)
            .values({
                displayName,
                email,
                emailVerifiedAt: new Date(),
                passwordHash,
                status: 'active',
            })
            .returning({ email: users.email, id: users.id })
        const user = userRows.at(0)

        if (!user) {
            throw new AuthDomainError('service_unavailable', 'First owner could not be created.')
        }

        await transaction.insert(userRoles).values({ roleId: ownerRole.id, userId: user.id })

        await writeManagementOriginInTransaction(transaction, managementOrigin)

        return { success: true as const, userId: user.id, email: user.email }
    })
}
