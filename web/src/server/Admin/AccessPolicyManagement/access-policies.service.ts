import '@tanstack/react-start/server-only'

import { asc, count, eq } from 'drizzle-orm'
import type { z } from 'zod'

import {
    ACCESS_POLICY_COMBINATIONS,
    ACCESS_POLICY_MODES,
    MAX_ACCESS_POLICIES,
    type AccessPolicyCombination,
    type AccessPolicyMode,
} from '../../../config/access-policies.config'
import { PERMISSIONS } from '../../../config/permissions.config'
import { accessPolicyBasicAuthAccounts, accessPolicies, proxyHosts } from '../../../db/schema'
import type { AccessPolicySummary } from '../../../shared/Types/access-policies.types'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import { reconcileProxyConfigurationService } from '../../ProxyRuntime/proxy-runtime.service'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import {
    accessPolicyIdInputSchema,
    createAccessPolicyInputSchema,
    updateAccessPolicyInputSchema,
    type CreateAccessPolicyInput,
    type UpdateAccessPolicyInput,
} from '../../../features/Admin/AccessPolicyManagement/validation'
import { AccessPolicyDomainError } from './access-policies.errors'

export type AccessPolicyMutationResult = AccessPolicySummary & {
    readonly accessPolicyId: string
    readonly runtimeStatus: 'applied' | 'pending'
}

type AccessPolicyRow = typeof accessPolicies.$inferSelect

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
    const parsed = parseCreate(input)
    assertPolicyShape(parsed.mode, parsed.combination)
    const row = await getAuthDatabase().transaction(async (transaction) => {
        await lockProxyRuntimeSettings(transaction)
        await requirePermissionInTransaction(
            transaction,
            actor.id,
            PERMISSIONS.ACCESS_POLICIES_CREATE,
        )
        const existing = await transaction.select({ id: accessPolicies.id }).from(accessPolicies)
        if (existing.length >= MAX_ACCESS_POLICIES) {
            throw new AccessPolicyDomainError('invalid_input')
        }
        const rows = await transaction.insert(accessPolicies).values(parsed).returning()
        const created = rows.at(0)
        if (!created) throw new AccessPolicyDomainError('controller_unavailable')
        return created
    })
    return {
        ...toSummary(row, 0, 0),
        accessPolicyId: row.id,
        runtimeStatus: await reconcileProxyConfigurationService(),
    }
}

export async function updateAccessPolicyService(
    input: UpdateAccessPolicyInput,
): Promise<AccessPolicyMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_UPDATE)
    const parsed = parseUpdate(input)
    const id = parsed.accessPolicyId.toLowerCase()
    const row = await getAuthDatabase().transaction(async (transaction) => {
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
        assertPolicyShape(mode, combination)
        const rows = await transaction
            .update(accessPolicies)
            .set({
                ...(parsed.name === undefined ? {} : { name: parsed.name }),
                ...(parsed.description === undefined ? {} : { description: parsed.description }),
                mode,
                combination,
                updatedAt: new Date(),
            })
            .where(eq(accessPolicies.id, id))
            .returning()
        const updated = rows.at(0)
        if (!updated) throw new AccessPolicyDomainError('access_policy_not_found')
        const accountRows = await transaction
            .select({ count: count() })
            .from(accessPolicyBasicAuthAccounts)
            .where(eq(accessPolicyBasicAuthAccounts.policyId, id))
        return {
            row: updated,
            count: await assignmentCount(transaction, id),
            basicAuthAccountCount: accountRows.at(0)?.count ?? 0,
        }
    })
    return {
        ...toSummary(row.row, row.count, row.basicAuthAccountCount),
        accessPolicyId: row.row.id,
        runtimeStatus: await reconcileProxyConfigurationService(),
    }
}

export async function deleteAccessPolicyService(
    accessPolicyId: string,
): Promise<{ readonly accessPolicyId: string; readonly runtimeStatus: 'applied' | 'pending' }> {
    const actor = await requirePermissionService(PERMISSIONS.ACCESS_POLICIES_DELETE)
    const id = parseId(accessPolicyId)
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
    })
    return { accessPolicyId: id, runtimeStatus: await reconcileProxyConfigurationService() }
}
