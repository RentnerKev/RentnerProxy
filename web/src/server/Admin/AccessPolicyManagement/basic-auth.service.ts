import '@tanstack/react-start/server-only'

import { and, asc, count, eq } from 'drizzle-orm'
import type { z } from 'zod'

import { MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY } from '../../../config/access-policies.config'
import { accessPolicyBasicAuthAccounts, accessPolicies } from '../../../db/schema'
import type {
    BasicAuthAccountsPolicyInput,
    CreateBasicAuthAccountInput,
    DeleteBasicAuthAccountInput,
    UpdateBasicAuthAccountInput,
} from '../../../features/Admin/AccessPolicyManagement/basic-auth.validation'
import {
    basicAuthAccountsPolicyInputSchema,
    createBasicAuthAccountInputSchema,
    deleteBasicAuthAccountInputSchema,
    updateBasicAuthAccountInputSchema,
} from '../../../features/Admin/AccessPolicyManagement/basic-auth.validation'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { reconcileProxyConfigurationService } from '../../ProxyRuntime/proxy-runtime.service'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import { AccessPolicyDomainError } from './access-policies.errors'
import { BasicAuthDomainError } from './basic-auth.errors'
import { PERMISSIONS } from '../../../config/permissions.config'

export interface BasicAuthAccountSummary {
    readonly id: string
    readonly accessPolicyId: string
    readonly username: string
    readonly createdAt: Date
    readonly updatedAt: Date
}

export interface BasicAuthMutationResult {
    readonly accountId: string
    readonly runtimeStatus: 'applied' | 'pending'
}

type BasicAuthAccountRow = typeof accessPolicyBasicAuthAccounts.$inferSelect

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new BasicAuthDomainError('invalid_input')
    return parsed.data
}

function parsePolicyInput(input: BasicAuthAccountsPolicyInput): string {
    return parseInput(basicAuthAccountsPolicyInputSchema, input).accessPolicyId.toLowerCase()
}

function toSummary(row: BasicAuthAccountRow): BasicAuthAccountSummary {
    return {
        id: row.id,
        accessPolicyId: row.policyId,
        username: row.username,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

function mapDatabaseError(error: unknown): BasicAuthDomainError | null {
    const seen = new Set<unknown>()
    let current: unknown = error
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current)
        const databaseError = current as Record<string, unknown>
        const uniqueViolation = [
            databaseError.code,
            databaseError.errno,
            databaseError.sqlState,
        ].includes('23505')
        const constraint =
            databaseError.constraint ??
            databaseError.constraintName ??
            databaseError.constraint_name
        if (
            uniqueViolation &&
            constraint === 'access_policy_basic_auth_accounts_policy_username_unique'
        ) {
            return new BasicAuthDomainError('basic_auth_username_conflict')
        }
        current = databaseError.cause
    }
    return null
}

async function requirePolicyExists(policyId: string): Promise<void> {
    const rows = await getAuthDatabase()
        .select({ id: accessPolicies.id })
        .from(accessPolicies)
        .where(eq(accessPolicies.id, policyId))
        .limit(1)
    if (!rows.at(0)) throw new AccessPolicyDomainError('access_policy_not_found')
}

async function requireAccountExists(policyId: string, accountId: string): Promise<void> {
    const rows = await getAuthDatabase()
        .select({ id: accessPolicyBasicAuthAccounts.id })
        .from(accessPolicyBasicAuthAccounts)
        .where(
            and(
                eq(accessPolicyBasicAuthAccounts.policyId, policyId),
                eq(accessPolicyBasicAuthAccounts.id, accountId),
            ),
        )
        .limit(1)
    if (!rows.at(0)) throw new BasicAuthDomainError('basic_auth_account_not_found')
}

async function requirePolicyForUpdate(
    transaction: AuthTransaction,
    policyId: string,
): Promise<void> {
    const rows = await transaction
        .select({ id: accessPolicies.id })
        .from(accessPolicies)
        .where(eq(accessPolicies.id, policyId))
        .limit(1)
        .for('update')
    if (!rows.at(0)) throw new AccessPolicyDomainError('access_policy_not_found')
}

async function requireAccountForUpdate(
    transaction: AuthTransaction,
    policyId: string,
    accountId: string,
): Promise<BasicAuthAccountRow> {
    const rows = await transaction
        .select()
        .from(accessPolicyBasicAuthAccounts)
        .where(
            and(
                eq(accessPolicyBasicAuthAccounts.policyId, policyId),
                eq(accessPolicyBasicAuthAccounts.id, accountId),
            ),
        )
        .limit(1)
        .for('update')
    const row = rows.at(0)
    if (!row) throw new BasicAuthDomainError('basic_auth_account_not_found')
    return row
}

async function hashBasicAuthPassword(password: string): Promise<string> {
    const hash = await Bun.password.hash(password, {
        algorithm: 'argon2id',
        memoryCost: 47_104,
        timeCost: 1,
    })
    if (!/^\$argon2id\$v=19\$m=47104,t=1,p=1\$[A-Za-z0-9+/]{43}\$[A-Za-z0-9+/]{43}$/u.test(hash)) {
        throw new Error('Basic Auth password hashing returned an unsupported format.')
    }
    return hash
}

export async function getBasicAuthAccountsService(
    input: BasicAuthAccountsPolicyInput,
): Promise<Array<BasicAuthAccountSummary>> {
    await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_VIEW)
    const policyId = parsePolicyInput(input)
    await requirePolicyExists(policyId)
    const rows = await getAuthDatabase()
        .select()
        .from(accessPolicyBasicAuthAccounts)
        .where(eq(accessPolicyBasicAuthAccounts.policyId, policyId))
        .orderBy(asc(accessPolicyBasicAuthAccounts.username), asc(accessPolicyBasicAuthAccounts.id))
    return rows.map(toSummary)
}

export async function createBasicAuthAccountService(
    input: CreateBasicAuthAccountInput,
): Promise<BasicAuthMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_UPDATE)
    const parsed = parseInput(createBasicAuthAccountInputSchema, input)
    const policyId = parsed.accessPolicyId.toLowerCase()
    await requirePolicyExists(policyId)
    const passwordHash = await hashBasicAuthPassword(parsed.password)
    let accountId: string
    try {
        accountId = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.ACCESS_POLICIES_UPDATE,
            )
            await requirePolicyForUpdate(transaction, policyId)
            const existing = await transaction
                .select({ count: count() })
                .from(accessPolicyBasicAuthAccounts)
                .where(eq(accessPolicyBasicAuthAccounts.policyId, policyId))
            if ((existing.at(0)?.count ?? 0) >= MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY) {
                throw new BasicAuthDomainError('basic_auth_account_limit')
            }
            const rows = await transaction
                .insert(accessPolicyBasicAuthAccounts)
                .values({
                    policyId,
                    username: parsed.username,
                    passwordHash,
                })
                .returning({ id: accessPolicyBasicAuthAccounts.id })
            const created = rows.at(0)
            if (!created) throw new BasicAuthDomainError('basic_auth_account_not_found')
            return created.id
        })
    } catch (error) {
        const mapped = mapDatabaseError(error)
        if (mapped) throw mapped
        throw error
    }
    return { accountId, runtimeStatus: await reconcileProxyConfigurationService() }
}

export async function updateBasicAuthAccountService(
    input: UpdateBasicAuthAccountInput,
): Promise<BasicAuthMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_UPDATE)
    const parsed = parseInput(updateBasicAuthAccountInputSchema, input)
    const policyId = parsed.accessPolicyId.toLowerCase()
    const accountId = parsed.accountId.toLowerCase()
    await requirePolicyExists(policyId)
    await requireAccountExists(policyId, accountId)
    const passwordHash =
        parsed.password === undefined ? undefined : await hashBasicAuthPassword(parsed.password)
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.ACCESS_POLICIES_UPDATE,
            )
            await requirePolicyForUpdate(transaction, policyId)
            const current = await requireAccountForUpdate(transaction, policyId, accountId)
            await transaction
                .update(accessPolicyBasicAuthAccounts)
                .set({
                    username: parsed.username ?? current.username,
                    passwordHash: passwordHash ?? current.passwordHash,
                    updatedAt: new Date(),
                })
                .where(eq(accessPolicyBasicAuthAccounts.id, current.id))
        })
    } catch (error) {
        const mapped = mapDatabaseError(error)
        if (mapped) throw mapped
        throw error
    }
    return { accountId, runtimeStatus: await reconcileProxyConfigurationService() }
}

export async function deleteBasicAuthAccountService(
    input: DeleteBasicAuthAccountInput,
): Promise<BasicAuthMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_UPDATE)
    const parsed = parseInput(deleteBasicAuthAccountInputSchema, input)
    const policyId = parsed.accessPolicyId.toLowerCase()
    const accountId = parsed.accountId.toLowerCase()
    await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(
            transaction,
            actor.id,
            PERMISSIONS.ACCESS_POLICIES_UPDATE,
        )
        await requirePolicyForUpdate(transaction, policyId)
        const current = await requireAccountForUpdate(transaction, policyId, accountId)
        await transaction
            .delete(accessPolicyBasicAuthAccounts)
            .where(eq(accessPolicyBasicAuthAccounts.id, current.id))
    })
    return { accountId, runtimeStatus: await reconcileProxyConfigurationService() }
}
