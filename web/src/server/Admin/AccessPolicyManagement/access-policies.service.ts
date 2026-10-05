import type { AccessPolicyMutationResult, AccessPolicyRow } from './Types/access-policies.types.ts'
import '@tanstack/react-start/server-only'
import { QUICK_SEARCH_LIMIT } from '@/config/quick-search.config.ts'
import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type {
    QuickSearchEntity,
    QuickSearchInput,
} from '@/lib/QuickSearch/Types/quick-search.types.ts'
import {
    getQuickSearchPattern,
    quickSearchInputSchema,
} from '@/lib/QuickSearch/quickSearchValidation.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'

import { asc, count, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'

import {
    ACCESS_POLICY_COMBINATIONS,
    ACCESS_POLICY_MODES,
    MAX_ACCESS_POLICIES,
} from '@/config/access-policies.config.ts'
import type {
    AccessPolicyCombination,
    AccessPolicyMode,
} from '@/config/Types/access-policies-config.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { accessPolicyBasicAuthAccounts, accessPolicies, proxyHosts } from '@/db/schema.ts'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { reconcileProxyConfigurationWithAudit } from '@/server/ProxyRuntime/proxy-runtime.service.ts'
import { lockProxyRuntimeSettings } from '@/server/ProxyRuntime/proxy-runtime-settings.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import { recordMutationFailureBestEffort } from '@/server/ProxyRuntime/audit-mutation.ts'
import {
    accessPolicyIdInputSchema,
    createAccessPolicyInputSchema,
    updateAccessPolicyInputSchema,
} from '@/features/Admin/AccessPolicyManagement/validation.ts'
import type {
    CreateAccessPolicyInput,
    UpdateAccessPolicyInput,
} from '@/features/Admin/AccessPolicyManagement/Types/validation.types.ts'
import { AccessPolicyDomainError } from './access-policies.errors.ts'
import { createBasicAuthAccountInTransaction, hashBasicAuthPassword } from './basic-auth.service.ts'
import { forwardAuthInputSchema } from '@/lib/ForwardAuth/forwardAuth.ts'
import type { ForwardAuthConfiguration } from '@/lib/ForwardAuth/Types/forward-auth.types.ts'

function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new AccessPolicyDomainError('invalid_input')
    return parsed.data
}

function parseCreate(input: CreateAccessPolicyInput) {
    return parseInput(createAccessPolicyInputSchema, input)
}

function parseUpdate(input: UpdateAccessPolicyInput) {
    return parseInput(updateAccessPolicyInputSchema, input)
}

function parseId(accessPolicyId: string): string {
    return parseInput(accessPolicyIdInputSchema, { accessPolicyId }).accessPolicyId.toLowerCase()
}

function assertPolicyShape(
    mode: AccessPolicyMode,
    combination: AccessPolicyCombination | null,
    forwardAuth: ForwardAuthConfiguration | null,
): void {
    if (!(ACCESS_POLICY_MODES as readonly string[]).includes(mode)) {
        throw new AccessPolicyDomainError('invalid_input')
    }
    if ((mode === 'combined') !== (combination !== null)) {
        throw new AccessPolicyDomainError('invalid_input')
    }
    if (
        combination !== null &&
        !(ACCESS_POLICY_COMBINATIONS as readonly string[]).includes(combination)
    ) {
        throw new AccessPolicyDomainError('invalid_input')
    }
    if (
        forwardAuth !== null &&
        (mode === 'public' ||
            mode === 'ip-restricted' ||
            (mode === 'combined' && combination !== 'all'))
    ) {
        throw new AccessPolicyDomainError('invalid_input')
    }
}

function parseForwardAuth(value: unknown): ForwardAuthConfiguration | null {
    if (value === null || value === undefined) return null
    const parsed = forwardAuthInputSchema.safeParse(value)
    if (!parsed.success) throw new AccessPolicyDomainError('invalid_input')
    return parsed.data
}

function toSummary(
    row: AccessPolicyRow,
    assignedHostCount: number,
    basicAuthAccountCount: number,
): AccessPolicySummary {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        mode: row.mode,
        combination: row.combination,
        ipRules: row.ipRules,
        forwardAuth: parseForwardAuth(row.forwardAuth),
        assignedHostCount,
        basicAuthAccountCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

async function readSummaries(): Promise<Array<AccessPolicySummary>> {
    return getAuthDatabase().transaction(
        async (transaction) => {
            const rows = await transaction
                .select()
                .from(accessPolicies)
                .orderBy(asc(accessPolicies.name), asc(accessPolicies.id))
                .limit(MAX_ACCESS_POLICIES)
            const assignments = await transaction
                .select({ accessPolicyId: proxyHosts.accessPolicyId, count: count() })
                .from(proxyHosts)
                .groupBy(proxyHosts.accessPolicyId)
            const counts = new Map(
                assignments.flatMap((entry) =>
                    entry.accessPolicyId === null
                        ? []
                        : [[entry.accessPolicyId, entry.count] as const],
                ),
            )
            const basicAuthAccounts = await transaction
                .select({ policyId: accessPolicyBasicAuthAccounts.policyId, count: count() })
                .from(accessPolicyBasicAuthAccounts)
                .groupBy(accessPolicyBasicAuthAccounts.policyId)
            const accountCounts = new Map(
                basicAuthAccounts.map((entry) => [entry.policyId, entry.count] as const),
            )
            return rows.map((row) =>
                toSummary(row, counts.get(row.id) ?? 0, accountCounts.get(row.id) ?? 0),
            )
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
}

export async function getAccessPoliciesService(): Promise<Array<AccessPolicySummary>> {
    await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_VIEW)
    return readSummaries()
}

export async function getAssignableAccessPoliciesService(): Promise<Array<AccessPolicySummary>> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_ASSIGN)
    if (
        !actor.permissions.includes(PERMISSIONS.PROXY_HOSTS_CREATE) &&
        !actor.permissions.includes(PERMISSIONS.PROXY_HOSTS_UPDATE)
    ) {
        throw new AccessPolicyDomainError('access_policy_not_found')
    }
    return readSummaries()
}

async function getPolicyForUpdate(
    transaction: AuthTransaction,
    id: string,
): Promise<AccessPolicyRow> {
    const rows = await transaction
        .select()
        .from(accessPolicies)
        .where(eq(accessPolicies.id, id))
        .limit(1)
        .for('update')
    const row = rows.at(0)
    if (!row) throw new AccessPolicyDomainError('access_policy_not_found')
    return row
}

async function assignmentCount(transaction: AuthTransaction, id: string): Promise<number> {
    const rows = await transaction
        .select({ count: count() })
        .from(proxyHosts)
        .where(eq(proxyHosts.accessPolicyId, id))
    return rows.at(0)?.count ?? 0
}

export async function createAccessPolicyService(
    input: CreateAccessPolicyInput,
): Promise<AccessPolicyMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_CREATE)
    let row: AccessPolicyRow
    try {
        row = await getAuthDatabase().transaction((transaction) =>
            createAccessPolicyInTransaction(transaction, actor.id, input),
        )
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'create',
            resource: 'access-policy',
            targetId: null,
            error,
        })
        throw error
    }
    return {
        ...toSummary(row, 0, input.basicAuth === undefined ? 0 : 1),
        accessPolicyId: row.id,
        runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id),
    }
}

export async function createAccessPolicyInTransaction(
    transaction: AuthTransaction,
    actorId: string,
    input: CreateAccessPolicyInput,
): Promise<AccessPolicyRow> {
    const { basicAuth, ...parsed } = parseCreate(input)
    assertPolicyShape(parsed.mode, parsed.combination, parsed.forwardAuth)
    await lockProxyRuntimeSettings(transaction)
    await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.ACCESS_POLICIES_CREATE)
    const credentials = basicAuth
        ? {
              username: basicAuth.username,
              passwordHash: await hashBasicAuthPassword(basicAuth.password),
          }
        : undefined
    const existing = await transaction.select({ id: accessPolicies.id }).from(accessPolicies)
    if (existing.length >= MAX_ACCESS_POLICIES) {
        throw new AccessPolicyDomainError('invalid_input')
    }
    const rows = await transaction.insert(accessPolicies).values(parsed).returning()
    const created = rows.at(0)
    if (!created) throw new AccessPolicyDomainError('controller_unavailable')
    if (credentials) {
        await createBasicAuthAccountInTransaction(transaction, actorId, created.id, credentials)
    }
    await appendAuditEventInTransactionService(transaction, {
        actorUserId: actorId,
        actorKind: 'user',
        action: 'create',
        resource: 'access-policy',
        targetId: created.id,
        result: 'success',
    })
    return created
}

export async function updateAccessPolicyService(
    input: UpdateAccessPolicyInput,
): Promise<AccessPolicyMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_UPDATE)
    const parsed = parseUpdate(input)
    const id = parsed.accessPolicyId.toLowerCase()
    const credentials = parsed.basicAuth
        ? {
              username: parsed.basicAuth.username,
              passwordHash: await hashBasicAuthPassword(parsed.basicAuth.password),
          }
        : undefined
    let row: {
        readonly row: AccessPolicyRow
        readonly count: number
        readonly basicAuthAccountCount: number
    }
    try {
        row = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.ACCESS_POLICIES_UPDATE,
            )
            const current = await getPolicyForUpdate(transaction, id)
            const mode = parsed.mode ?? current.mode
            const combination =
                parsed.combination !== undefined
                    ? parsed.combination
                    : mode === 'combined'
                      ? current.combination
                      : null
            const currentForwardAuth = parseForwardAuth(current.forwardAuth)
            const forwardAuth =
                mode === 'public' || mode === 'ip-restricted'
                    ? null
                    : parsed.forwardAuth !== undefined
                      ? parsed.forwardAuth
                      : currentForwardAuth
            assertPolicyShape(mode, combination, forwardAuth)
            if (credentials && (mode === 'public' || mode === 'ip-restricted' || forwardAuth)) {
                throw new AccessPolicyDomainError('invalid_input')
            }
            const forwardAuthChanged =
                JSON.stringify(forwardAuth) !== JSON.stringify(currentForwardAuth)
            const rows = await transaction
                .update(accessPolicies)
                .set({
                    ...(parsed.name === undefined ? {} : { name: parsed.name }),
                    ...(parsed.description === undefined
                        ? {}
                        : { description: parsed.description }),
                    ...(parsed.ipRules === undefined ? {} : { ipRules: parsed.ipRules }),
                    forwardAuth,
                    mode,
                    combination,
                    updatedAt: new Date(),
                })
                .where(eq(accessPolicies.id, id))
                .returning()
            const updated = rows.at(0)
            if (!updated) throw new AccessPolicyDomainError('access_policy_not_found')
            if (credentials) {
                await createBasicAuthAccountInTransaction(transaction, actor.id, id, credentials)
            }
            const accountRows = await transaction
                .select({ count: count() })
                .from(accessPolicyBasicAuthAccounts)
                .where(eq(accessPolicyBasicAuthAccounts.policyId, id))
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'update',
                resource: 'access-policy',
                targetId: id,
                result: 'success',
                metadata: {
                    changedFields: [
                        ...(parsed.name === undefined ? [] : (['name'] as const)),
                        ...(parsed.description === undefined ? [] : (['description'] as const)),
                        ...(parsed.mode === undefined ? [] : (['mode'] as const)),
                        ...(parsed.combination === undefined ? [] : (['combination'] as const)),
                        ...(parsed.ipRules === undefined ? [] : (['ipRules'] as const)),
                        ...(forwardAuthChanged ? (['forwardAuth'] as const) : []),
                    ],
                },
            })
            return {
                row: updated,
                count: await assignmentCount(transaction, id),
                basicAuthAccountCount: accountRows.at(0)?.count ?? 0,
            }
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'update',
            resource: 'access-policy',
            targetId: id,
            error,
        })
        throw error
    }
    return {
        ...toSummary(row.row, row.count, row.basicAuthAccountCount),
        accessPolicyId: row.row.id,
        runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id),
    }
}

export async function deleteAccessPolicyService(
    accessPolicyId: string,
): Promise<{ readonly accessPolicyId: string; readonly runtimeStatus: 'applied' | 'pending' }> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_DELETE)
    const id = parseId(accessPolicyId)
    try {
        await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(
                transaction,
                actor.id,
                PERMISSIONS.ACCESS_POLICIES_DELETE,
            )
            await getPolicyForUpdate(transaction, id)
            if ((await assignmentCount(transaction, id)) > 0) {
                throw new AccessPolicyDomainError('access_policy_in_use')
            }
            await transaction.delete(accessPolicies).where(eq(accessPolicies.id, id))
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'delete',
                resource: 'access-policy',
                targetId: id,
                result: 'success',
            })
        })
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'delete',
            resource: 'access-policy',
            targetId: id,
            error,
        })
        throw error
    }
    return {
        accessPolicyId: id,
        runtimeStatus: await reconcileProxyConfigurationWithAudit(actor.id),
    }
}

export async function searchAccessPoliciesService(
    actor: AuthenticatedUser,
    input: QuickSearchInput,
): Promise<Array<QuickSearchEntity>> {
    if (!actor.permissions.includes(PERMISSIONS.ACCESS_POLICIES_VIEW)) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }
    const currentActor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_VIEW)
    if (currentActor.id !== actor.id) {
        throw new AuthDomainError('permission_denied', 'Permission is required.')
    }
    const parsed = quickSearchInputSchema.safeParse(input)
    if (!parsed.success) {
        throw new AccessPolicyDomainError('invalid_input')
    }
    const pattern = getQuickSearchPattern(parsed.data.query)
    return getAuthDatabase()
        .select({
            id: accessPolicies.id,
            label: accessPolicies.name,
            detail: sql<string>`left(${accessPolicies.description}, 256)`,
        })
        .from(accessPolicies)
        .where(
            parsed.data.id
                ? eq(accessPolicies.id, parsed.data.id)
                : sql`${accessPolicies.name} ilike ${pattern} escape '\\' or ${accessPolicies.description} ilike ${pattern} escape '\\'`,
        )
        .orderBy(asc(accessPolicies.id))
        .limit(parsed.data.id ? 1 : QUICK_SEARCH_LIMIT)
}
