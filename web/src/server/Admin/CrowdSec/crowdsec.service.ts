import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '../../../config/permissions.config'
import {
    testCrowdSecConnectionSchema,
    updateCrowdSecConfigurationSchema,
    type TestCrowdSecConnectionInput,
    type UpdateCrowdSecConfigurationInput,
} from '../../../features/Admin/CrowdSec/validation'
import type {
    CrowdSecConfiguration,
    CrowdSecMutationResult,
    CrowdSecRuntimeStatus,
} from '../../../shared/Types/crowdsec.types'
import type { ProxyRuntimeMutationStatus } from '../../../shared/Types/proxy-runtime.types'
import { requirePermissionService } from '../../Auth/Access/authorization.service'
import { requirePermissionInTransaction } from '../../Auth/Access/rbac.service'
import { getAuthDatabase } from '../../Auth/Core/database.server'
import { appendAuditEventInTransaction } from '../../Audit/audit.service'
import {
    applyCrowdSecConfiguration,
    getCrowdSecRuntimeStatus,
    testCrowdSecControllerConnection,
    type CrowdSecControllerRequest,
} from '../../Foundation/controller.server'
import { recordMutationFailureBestEffort } from '../../ProxyRuntime/audit-mutation'
import { CrowdSecDomainError } from './crowdsec.errors'
import { createCrowdSecReconciler } from './crowdsec-reconcile'
import {
    buildStoredCrowdSecConfiguration,
    crowdSecConfigurationFingerprint,
    crowdSecControllerRequestFromStored,
    externalApiKeyFromStored,
    lockStoredCrowdSecConfiguration,
    normalizeCrowdSecApiUrl,
    readStoredCrowdSecConfiguration,
    writeStoredCrowdSecConfiguration,
    type StoredCrowdSecConfiguration,
} from './crowdsec-settings'

interface ReconcileSnapshot {
    readonly fingerprint: string
    readonly request: CrowdSecControllerRequest
}

function runtimeMatches(
    stored: StoredCrowdSecConfiguration,
    runtime: CrowdSecRuntimeStatus | null,
): boolean {
    if (!runtime || runtime.mode !== stored.mode) return false
    if (stored.mode === 'disabled') return !runtime.enforcementActive
    if (!runtime.enforcementActive || runtime.state !== 'connected') return false
    if (stored.mode === 'managed') return runtime.credentialConfigured === false
    return runtime.credentialConfigured && runtime.apiUrl === stored.external?.apiUrl
}

async function loadReconcileSnapshot(): Promise<ReconcileSnapshot> {
    const stored = await getAuthDatabase().transaction(
        (transaction) => readStoredCrowdSecConfiguration(transaction),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    return {
        fingerprint: crowdSecConfigurationFingerprint(stored),
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
        ? !runtime.credentialConfigured
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
            : runtime.credentialConfigured
    },
})

export function startCrowdSecReconciliation(): void {
    reconcileCrowdSecConfiguration.start()
}

export function stopCrowdSecReconciliation(): Promise<void> {
    return reconcileCrowdSecConfiguration.stop()
}

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
        externalApiUrl: stored.external?.apiUrl ?? null,
        hasApiKey: stored.external !== undefined,
        runtime,
        synchronized: runtimeMatches(stored, runtime),
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
    const apiKey = parsed.data.apiKey ?? (await externalApiKeyFromStored(stored))
    await verifyExternalTarget(normalizeCrowdSecApiUrl(parsed.data.apiUrl), apiKey)
}

async function persistCrowdSecConfiguration(
    actorId: string,
    baseline: StoredCrowdSecConfiguration,
    next: StoredCrowdSecConfiguration,
): Promise<void> {
    await getAuthDatabase().transaction(async (transaction) => {
        const current = await lockStoredCrowdSecConfiguration(transaction)
        if (
            crowdSecConfigurationFingerprint(current) !== crowdSecConfigurationFingerprint(baseline)
        ) {
            throw new CrowdSecDomainError('configuration_conflict')
        }
        await requirePermissionInTransaction(transaction, actorId, PERMISSIONS.CROWDSEC_UPDATE)
        await writeStoredCrowdSecConfiguration(transaction, next)
        await appendAuditEventInTransaction(transaction, {
            actorUserId: actorId,
            actorKind: 'user',
            action: 'update',
            resource: 'crowdsec',
            targetId: null,
            result: 'success',
        })
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
