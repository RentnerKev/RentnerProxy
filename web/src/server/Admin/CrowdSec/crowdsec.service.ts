import type { ReconcileSnapshot } from './Types/crowdsec.types.ts'
import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    testCrowdSecConnectionSchema,
    updateCrowdSecConfigurationSchema,
    crowdSecConsoleEnrollmentSchema,
    crowdSecDashboardQuerySchema,
} from '@/features/Admin/CrowdSec/validation.ts'
import type {
    TestCrowdSecConnectionInput,
    UpdateCrowdSecConfigurationInput,
} from '@/features/Admin/CrowdSec/Types/validation.types.ts'
import type {
    CrowdSecConfiguration,
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
    CrowdSecMutationResult,
    CrowdSecRuntimeStatus,
} from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { appendAuditEventInTransactionService } from '@/server/Audit/audit.service.ts'
import {
    applyCrowdSecConfiguration,
    enrollCrowdSecConsole,
    getCrowdSecRuntimeStatus,
    getCrowdSecDashboard,
    testCrowdSecControllerConnection,
} from '@/server/Controller/crowdsec.server.ts'
import type { CrowdSecControllerRequest } from '@/server/Controller/Types/crowdsec.types.ts'
import { recordMutationFailureBestEffort } from '@/server/ProxyRuntime/audit-mutation.ts'
import { CrowdSecDomainError } from './crowdsec.errors.ts'
import { getLocalDemoDashboard } from './crowdsec-demo.server.ts'
import { enrichCrowdSecCountryCodes } from './crowdsec-geoip.server.ts'
import { createCrowdSecReconciler } from './crowdsec-reconcile.ts'
import {
    buildStoredCrowdSecConfiguration,
    crowdSecControllerRequestFromStored,
    externalApiKeyFromStored,
    lockStoredCrowdSecConfiguration,
    normalizeCrowdSecApiUrl,
    readStoredCrowdSecConfiguration,
    writeStoredCrowdSecConfiguration,
} from './crowdsec-settings.ts'
import type { StoredCrowdSecConfiguration } from './Types/crowdsec-settings.types.ts'

function runtimeMatches(
    stored: StoredCrowdSecConfiguration,
    runtime: CrowdSecRuntimeStatus | null,
): boolean {
    if (!runtime || runtime.mode !== stored.mode) return false
    if (stored.mode === 'disabled') return !runtime.enforcementActive
    if (!runtime.enforcementActive || runtime.state !== 'connected') return false
    if (stored.mode === 'managed')
        return (
            runtime.credentialConfigured === false &&
            runtime.communityEnabled === (stored.communityEnabled ?? false)
        )
    return runtime.credentialConfigured && runtime.apiUrl === stored.external?.apiUrl
}

async function loadReconcileSnapshot(): Promise<ReconcileSnapshot> {
    const stored = await getAuthDatabase().transaction(
        (transaction) => readStoredCrowdSecConfiguration(transaction),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    return {
        fingerprint: JSON.stringify(stored),
        request: await crowdSecControllerRequestFromStored(stored),
    }
}

function controllerResponseMatches(
    request: CrowdSecControllerRequest,
    runtime: CrowdSecRuntimeStatus | null,
): boolean {
    if (!runtime || runtime.mode !== request.mode) return false
    if (request.mode === 'disabled') return !runtime.enforcementActive
    if (!runtime.enforcementActive || runtime.state !== 'connected') return false
    return request.mode === 'managed'
        ? !runtime.credentialConfigured &&
              runtime.communityEnabled === (request.communityEnabled ?? false)
        : runtime.credentialConfigured && runtime.apiUrl === request.apiUrl
}

export const reconcileCrowdSecConfiguration = createCrowdSecReconciler({
    load: loadReconcileSnapshot,
    apply: async (snapshot) =>
        controllerResponseMatches(
            snapshot.request,
            await applyCrowdSecConfiguration(snapshot.request),
        ),
    hasDrift: async (snapshot) => {
        const runtime = await getCrowdSecRuntimeStatus()
        if (!runtime || runtime.mode !== snapshot.request.mode) return true
        if (snapshot.request.mode === 'disabled') return runtime.enforcementActive
        if (!runtime.enforcementActive || runtime.state !== 'connected') return true
        return snapshot.request.mode === 'external'
            ? !runtime.credentialConfigured || runtime.apiUrl !== snapshot.request.apiUrl
            : runtime.credentialConfigured ||
                  runtime.communityEnabled !== (snapshot.request.communityEnabled ?? false)
    },
})

export async function getCrowdSecConfigurationService(): Promise<CrowdSecConfiguration> {
    await requirePermissionService(PERMISSIONS.CROWDSEC_VIEW)
    const [stored, runtime] = await Promise.all([
        getAuthDatabase().transaction(
            (transaction) => readStoredCrowdSecConfiguration(transaction),
            { isolationLevel: 'repeatable read', accessMode: 'read only' },
        ),
        getCrowdSecRuntimeStatus(),
    ])
    return {
        mode: stored.mode,
        communityEnabled: stored.communityEnabled ?? false,
        externalApiUrl: stored.external?.apiUrl ?? null,
        hasApiKey: stored.external !== undefined,
        runtime,
        synchronized: runtimeMatches(stored, runtime),
    }
}

export async function getCrowdSecDashboardService(
    query: CrowdSecDashboardQuery,
): Promise<CrowdSecDashboard> {
    await requirePermissionService(PERMISSIONS.CROWDSEC_VIEW)
    const parsed = crowdSecDashboardQuerySchema.safeParse(query)
    if (!parsed.success) throw new CrowdSecDomainError('invalid_input')
    const demoDashboard = await getLocalDemoDashboard(parsed.data)
    if (demoDashboard) return demoDashboard
    const dashboard = await getCrowdSecDashboard(parsed.data)
    if (!dashboard) throw new CrowdSecDomainError('controller_unavailable')
    return enrichCrowdSecCountryCodes(dashboard)
}

export async function enrollCrowdSecConsoleService(input: {
    enrollmentKey: string
}): Promise<void> {
    const actor = await requirePermissionService(PERMISSIONS.CROWDSEC_UPDATE)
    const parsed = crowdSecConsoleEnrollmentSchema.safeParse(input)
    if (!parsed.success) throw new CrowdSecDomainError('invalid_input')
    const stored = await getAuthDatabase().transaction(
        async (transaction) => {
            await requirePermissionInTransaction(transaction, actor.id, PERMISSIONS.CROWDSEC_UPDATE)
            return readStoredCrowdSecConfiguration(transaction)
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    if (stored.mode !== 'managed' || !stored.communityEnabled) {
        throw new CrowdSecDomainError('community_not_ready')
    }
    try {
        const result = await enrollCrowdSecConsole(parsed.data.enrollmentKey)
        if (result === 'not_ready') throw new CrowdSecDomainError('community_not_ready')
        if (result === 'connection_failed') throw new CrowdSecDomainError('enrollment_failed')
        if (result !== 'pending') throw new CrowdSecDomainError('controller_unavailable')
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'request',
            resource: 'crowdsec',
            targetId: null,
            error,
        })
        throw error
    }
    try {
        await getAuthDatabase().transaction((transaction) =>
            appendAuditEventInTransactionService(transaction, {
                actorUserId: actor.id,
                actorKind: 'user',
                action: 'request',
                resource: 'crowdsec',
                targetId: null,
                result: 'success',
            }),
        )
    } catch {
        // Enrollment already reached CrowdSec. An audit write failure must not
        // be reported to the user as a failed connection or trigger a retry.
        console.error('[crowdsec] Console enrollment audit write failed')
    }
}

async function verifyExternalTarget(apiUrl: string, apiKey: string): Promise<void> {
    const result = await testCrowdSecControllerConnection({ apiUrl, apiKey })
    if (result === 'connection_failed') throw new CrowdSecDomainError('connection_failed')
    if (result !== 'connected') throw new CrowdSecDomainError('controller_unavailable')
}

export async function testCrowdSecConnectionService(
    input: TestCrowdSecConnectionInput,
): Promise<void> {
    await requirePermissionService(PERMISSIONS.CROWDSEC_UPDATE)
    const parsed = testCrowdSecConnectionSchema.safeParse(input)
    if (!parsed.success) throw new CrowdSecDomainError('invalid_input')
    const stored = await getAuthDatabase().transaction(
        (transaction) => readStoredCrowdSecConfiguration(transaction),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    const apiUrl = normalizeCrowdSecApiUrl(parsed.data.apiUrl)
    if (!parsed.data.apiKey && stored.external?.apiUrl !== apiUrl) {
        throw new CrowdSecDomainError('api_key_required')
    }
    const apiKey = parsed.data.apiKey ?? (await externalApiKeyFromStored(stored))
    await verifyExternalTarget(apiUrl, apiKey)
}

async function persistCrowdSecConfiguration(
    actorId: string,
    baseline: StoredCrowdSecConfiguration,
    next: StoredCrowdSecConfiguration,
): Promise<void> {
    await getAuthDatabase().transaction(async (transaction) => {
        const current = await lockStoredCrowdSecConfiguration(transaction)
        if (JSON.stringify(current) !== JSON.stringify(baseline)) {
            throw new CrowdSecDomainError('configuration_conflict')
        }
        await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.CROWDSEC_UPDATE)
        await writeStoredCrowdSecConfiguration(transaction, next)
        await appendAuditEventInTransactionService(transaction, {
            actorUserId: actorId,
            actorKind: 'user',
            action: 'update',
            resource: 'crowdsec',
            targetId: null,
            result: 'success',
        })
        if (
            baseline.external &&
            next.external &&
            (baseline.external.apiKey.ciphertext !== next.external.apiKey.ciphertext ||
                baseline.external.apiKey.iv !== next.external.apiKey.iv)
        ) {
            await appendAuditEventInTransactionService(transaction, {
                actorUserId: actorId,
                actorKind: 'user',
                action: 'rotate',
                resource: 'crowdsec',
                targetId: null,
                result: 'success',
            })
        }
    })
}

export async function updateCrowdSecConfigurationService(
    input: UpdateCrowdSecConfigurationInput,
): Promise<CrowdSecMutationResult> {
    const actor = await requirePermissionService(PERMISSIONS.CROWDSEC_UPDATE)
    const parsed = updateCrowdSecConfigurationSchema.safeParse(input)
    if (!parsed.success) throw new CrowdSecDomainError('invalid_input')

    try {
        const baseline = await getAuthDatabase().transaction(
            (transaction) => readStoredCrowdSecConfiguration(transaction),
            { isolationLevel: 'repeatable read', accessMode: 'read only' },
        )
        const next = await buildStoredCrowdSecConfiguration(baseline, parsed.data)
        if (next.mode === 'external' && next.external) {
            await verifyExternalTarget(next.external.apiUrl, await externalApiKeyFromStored(next))
        }
        await persistCrowdSecConfiguration(actor.id, baseline, next)
        const runtimeStatus: ProxyRuntimeMutationStatus = await reconcileCrowdSecConfiguration()
        return { runtimeStatus }
    } catch (error) {
        await recordMutationFailureBestEffort({
            actorId: actor.id,
            action: 'update',
            resource: 'crowdsec',
            targetId: null,
            error,
        })
        throw error
    }
}
