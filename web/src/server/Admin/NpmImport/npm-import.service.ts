import '@tanstack/react-start/server-only'

import { desc, eq } from 'drizzle-orm'

import { PERMISSIONS } from '../../../config/permissions.config'
import { hostDomains, npmImportRuns } from '../../../db/schema'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase, type AuthTransaction } from '../../Auth/Core/database.server'
import {
    recordAuditEventBestEffort,
    appendAuditEventInTransaction,
} from '../../Audit/audit.service'
import { reconcileProxyConfigurationWithAudit } from '../../ProxyRuntime/proxy-runtime.service'
import { lockProxyRuntimeSettings } from '../../ProxyRuntime/proxy-runtime-settings'
import { publishApplicationChange } from '../../../websockets/Helpers/publishFunctions'
import type {
    NpmImportPreview,
    NpmImportResult,
    NpmImportResultItem,
} from '../../../features/Admin/NpmImport/Types/npm-import.types'
import { createAccessPolicyInTransaction } from '../AccessPolicyManagement/access-policies.service'
import { createProxyHostInTransaction } from '../ProxyHostManagement/proxy-hosts.mutations.server'
import { createRedirectHostInTransaction } from '../RedirectHostManagement/redirect-hosts.service'
import { buildNpmImportPlan, publicNpmPreview, type NpmImportPlan } from './npm-plan'
import { readNpmSqliteSource } from './npm-source'
import { buildPortablePlan, readPortableSource } from '../Migration/portable'
import { buildZoraxyPlan, readZoraxySource } from '../Migration/zoraxy'

export type ImportSource = 'npm' | 'rentnerproxy' | 'zoraxy'

export class NpmImportError extends Error {
    constructor(readonly code: 'fingerprint_mismatch' | 'preview_changed') {
        super(code)
    }
}

async function existingDomainMap(transaction: AuthTransaction): Promise<Map<string, string>> {
    const rows = await transaction
        .select({
            domain: hostDomains.domain,
            proxyHostId: hostDomains.proxyHostId,
            redirectHostId: hostDomains.redirectHostId,
        })
        .from(hostDomains)
    return new Map(
        rows.map((row) => [
            row.domain,
            row.proxyHostId
                ? `proxy-host:${row.proxyHostId}`
                : `redirect-host:${row.redirectHostId}`,
        ]),
    )
}

async function planInTransaction(
    transaction: AuthTransaction,
    path: string,
    fingerprint: string,
    source: ImportSource,
): Promise<NpmImportPlan> {
    const domains = await existingDomainMap(transaction)
    if (source === 'npm') {
        return buildNpmImportPlan(readNpmSqliteSource(path), fingerprint, domains)
    }
    if (source === 'rentnerproxy') {
        return buildPortablePlan(await readPortableSource(path), fingerprint, domains)
    }
    return buildZoraxyPlan(await readZoraxySource(path), fingerprint, domains)
}

export async function previewImportService(
    path: string,
    fingerprint: string,
    source: ImportSource,
    permission: typeof PERMISSIONS.NPM_IMPORT | typeof PERMISSIONS.MIGRATION,
): Promise<NpmImportPreview> {
    await requirePermissionService(permission)
    const plan = await getAuthDatabase().transaction(
        (transaction) => planInTransaction(transaction, path, fingerprint, source),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    return publicNpmPreview(plan)
}

export async function applyImportService(
    path: string,
    fingerprint: string,
    expectedFingerprint: string,
    expectedPlanFingerprint: string,
    source: ImportSource,
    permission: typeof PERMISSIONS.NPM_IMPORT | typeof PERMISSIONS.MIGRATION,
): Promise<NpmImportResult> {
    const actor = await requirePermissionService(permission)
    const auditResource =
        source === 'npm' && permission === PERMISSIONS.NPM_IMPORT ? 'npm-import' : 'config-import'
    if (fingerprint !== expectedFingerprint || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
        throw new NpmImportError('fingerprint_mismatch')
    }
    await recordAuditEventBestEffort({
        actorUserId: actor.id,
        actorKind: 'user',
        action: 'started',
        resource: auditResource,
        targetId: null,
        result: 'success',
    })
    let committed: Omit<NpmImportResult, 'runtimeStatus'>
    const attempt: { plan: NpmImportPlan | null; confirmed: boolean } = {
        plan: null,
        confirmed: false,
    }
    try {
        committed = await getAuthDatabase().transaction(async (transaction) => {
            await lockProxyRuntimeSettings(transaction)
            await requirePermissionInTransaction(transaction, actor.id, permission)
            const plan = await planInTransaction(transaction, path, fingerprint, source)
            attempt.plan = plan
            if (publicNpmPreview(plan).planFingerprint !== expectedPlanFingerprint) {
                throw new NpmImportError('preview_changed')
            }
            attempt.confirmed = true
            const importable = plan.items.filter(
                (item) => item.status === 'ready' || item.status === 'partial',
            )
            const targets = new Map<string, string>()
            const policies = new Map<number, string>()
            for (const item of importable) {
                if (!item.policyInput) continue
                // oxlint-disable-next-line eslint/no-await-in-loop -- One transaction must serialize policy creation.
                const created = await createAccessPolicyInTransaction(
                    transaction,
                    actor.id,
                    item.policyInput,
                )
                policies.set(item.sourceId, created.id)
                targets.set(`${item.kind}:${item.sourceId}`, created.id)
            }
            for (const item of importable) {
                if (item.proxyInput) {
                    const accessPolicyId = item.accessListId
                        ? policies.get(item.accessListId)
                        : null
                    if (item.accessListId && !accessPolicyId) {
                        throw new Error('Import plan lost a required access policy.')
                    }
                    // oxlint-disable-next-line eslint/no-await-in-loop -- Host writes share one transaction and lock.
                    const created = await createProxyHostInTransaction(transaction, actor.id, {
                        ...item.proxyInput,
                        accessPolicyId,
                    })
                    targets.set(`${item.kind}:${item.sourceId}`, created.id)
                } else if (item.redirectInput) {
                    // oxlint-disable-next-line eslint/no-await-in-loop -- Host writes share one transaction and lock.
                    const created = await createRedirectHostInTransaction(
                        transaction,
                        actor.id,
                        item.redirectInput,
                    )
                    targets.set(`${item.kind}:${item.sourceId}`, created.id)
                }
            }
            const items: NpmImportResultItem[] = plan.items.map((item) => {
                const targetId = targets.get(`${item.kind}:${item.sourceId}`)
                return {
                    kind: item.kind,
                    sourceId: item.sourceId,
                    label: item.label,
                    domains: item.domains,
                    status: item.status,
                    reasons: item.reasons,
                    outcome: targetId ? 'imported' : 'skipped',
                    ...(targetId ? { targetId } : {}),
                }
            })
            const imported = items.filter((item) => item.outcome === 'imported').length
            const skipped = items.length - imported
            const rows = await transaction
                .insert(npmImportRuns)
                .values({
                    actorUserId: actor.id,
                    sourceFingerprint: fingerprint,
                    sourceSchema: plan.sourceSchema,
                    result: { status: 'completed', items, imported, skipped, failed: 0 },
                })
                .returning({ id: npmImportRuns.id })
            const runId = rows.at(0)?.id
            if (!runId) throw new Error('Import result could not be saved.')
            await appendAuditEventInTransaction(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'import',
                resource: auditResource,
                targetId: runId,
                result: 'success',
                metadata: { count: imported },
            })
            return {
                runId,
                status: 'completed' as const,
                fingerprint,
                sourceSchema: plan.sourceSchema,
                items,
                imported,
                skipped,
                failed: 0,
            }
        })
    } catch (error) {
        const failureCode = error instanceof NpmImportError ? 'conflict' : 'service_unavailable'
        const items: NpmImportResultItem[] = (attempt.plan?.items ?? []).map((item) => {
            const importable = item.status === 'ready' || item.status === 'partial'
            const failed = attempt.confirmed && importable
            return {
                kind: item.kind,
                sourceId: item.sourceId,
                label: item.label,
                domains: item.domains,
                status: item.status,
                reasons: importable
                    ? [...item.reasons, failed ? 'import_rolled_back' : 'preview_changed']
                    : item.reasons,
                outcome: failed ? 'failed' : 'skipped',
            }
        })
        const failed = items.filter((item) => item.outcome === 'failed').length
        const skipped = items.length - failed
        let recorded = false
        try {
            await getAuthDatabase().transaction(async (transaction) => {
                const rows = await transaction
                    .insert(npmImportRuns)
                    .values({
                        actorUserId: actor.id,
                        sourceFingerprint: fingerprint,
                        sourceSchema: attempt.plan?.sourceSchema ?? 'unknown',
                        runtimeStatus: 'not_applicable',
                        result: { status: 'failed', items, imported: 0, skipped, failed },
                    })
                    .returning({ id: npmImportRuns.id })
                const runId = rows.at(0)?.id
                if (!runId)
                    throw new Error('Import failure result could not be saved.', {
                        cause: error,
                    })
                await appendAuditEventInTransaction(transaction, {
                    actorUserId: actor.id,
                    actorKind: 'user',
                    action: 'failed',
                    resource: auditResource,
                    targetId: runId,
                    result: 'failure',
                    metadata: { failureCode, count: failed },
                })
            })
            recorded = true
        } catch {
            // The source transaction has already rolled back; audit remains best effort if storage is unavailable.
        }
        if (!recorded) {
            await recordAuditEventBestEffort({
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'failed',
                resource: auditResource,
                targetId: null,
                result: 'failure',
                metadata: { failureCode, count: failed },
            })
        }
        throw error
    }
    const runtimeStatus =
        committed.imported > 0
            ? await reconcileProxyConfigurationWithAudit(actor.id).catch(() => 'pending' as const)
            : ('applied' as const)
    await getAuthDatabase()
        .update(npmImportRuns)
        .set({ runtimeStatus })
        .where(eq(npmImportRuns.id, committed.runId))
        .catch(() => undefined)
    if (committed.imported > 0) publishApplicationChange()
    return { ...committed, runtimeStatus }
}

export async function getImportRunsService(
    permission: typeof PERMISSIONS.NPM_IMPORT | typeof PERMISSIONS.MIGRATION,
): Promise<readonly NpmImportResult[]> {
    await requirePermissionService(permission)
    const rows = await getAuthDatabase()
        .select()
        .from(npmImportRuns)
        .where(
            permission === PERMISSIONS.NPM_IMPORT
                ? eq(npmImportRuns.sourceSchema, 'npm-2.16-schema')
                : undefined,
        )
        .orderBy(desc(npmImportRuns.createdAt))
        .limit(20)
    return rows.map((row) => {
        const result = row.result as {
            status?: 'completed' | 'failed'
            items: NpmImportResultItem[]
            imported: number
            skipped: number
            failed?: number
        }
        return {
            runId: row.id,
            status: result.status === 'failed' ? 'failed' : 'completed',
            fingerprint: row.sourceFingerprint,
            sourceSchema: row.sourceSchema,
            items: result.items,
            imported: result.imported,
            skipped: result.skipped,
            failed: result.failed ?? 0,
            runtimeStatus:
                row.runtimeStatus === 'applied'
                    ? 'applied'
                    : row.runtimeStatus === 'not_applicable'
                      ? 'not_applicable'
                      : 'pending',
        }
    })
}

export const previewNpmImportService = (path: string, fingerprint: string) =>
    previewImportService(path, fingerprint, 'npm', PERMISSIONS.NPM_IMPORT)

export const applyNpmImportService = (
    path: string,
    fingerprint: string,
    expectedFingerprint: string,
    expectedPlanFingerprint: string,
) =>
    applyImportService(
        path,
        fingerprint,
        expectedFingerprint,
        expectedPlanFingerprint,
        'npm',
        PERMISSIONS.NPM_IMPORT,
    )

export const getNpmImportRunsService = () => getImportRunsService(PERMISSIONS.NPM_IMPORT)
