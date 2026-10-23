// oxlint-disable no-await-in-loop -- One bounded transaction serializes writes and savepoints under the runtime lock.
import '@tanstack/react-start/server-only'
import { createHash, randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { ProxyRuntimeSnapshotError } from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'
import { BULK_HOST_LIMITS } from '@/config/bulk-hosts.config.ts'
import {
    bulkHostApplySchema,
    bulkHostPreviewSchema,
} from '@/features/Admin/HostBulkActions/validation.ts'
import { bulkHostPermissions, bulkHostTagIds } from '@/lib/HostBulkActions/bulkHostActions.ts'
import type {
    BulkHostAction,
    BulkHostOutcome,
    BulkHostResult,
} from '@/lib/HostBulkActions/Types/bulk-hosts.types.ts'
import type { BulkHost, BulkHostDependencies } from './Types/bulk-hosts-service.types.ts'
import type { HostTagState } from '@/lib/HostTags/Types/host-tags.types.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'

function isUnchanged(host: BulkHost, tags: HostTagState, action: BulkHostAction): boolean {
    switch (action.type) {
        case 'enable':
            return host.enabled
        case 'disable':
            return !host.enabled
        case 'certificate':
            return host.certificateId === action.certificateId
        case 'accessPolicy':
            return (
                'accessPolicyId' in host && (host.accessPolicyId ?? null) === action.accessPolicyId
            )
        default:
            return (
                JSON.stringify(bulkHostTagIds(tags, host.id, action)) ===
                JSON.stringify((tags.assignments[host.id] ?? []).toSorted())
            )
    }
}

function versionFor(
    actorId: string,
    host: BulkHost,
    tags: HostTagState,
    action: BulkHostAction,
): string {
    // This is an optimistic concurrency fingerprint, never an authorization capability.
    return createHash('sha256')
        .update(
            JSON.stringify([
                actorId,
                action,
                host,
                (tags.assignments[host.id] ?? []).toSorted(),
                action.type === 'addTags' || action.type === 'removeTags' ? tags.tags : null,
            ]),
        )
        .digest('hex')
}

function failure(error: unknown): Pick<BulkHostOutcome, 'status' | 'reason'> {
    if (error instanceof ProxyRuntimeSnapshotError || error instanceof ZodError)
        return { status: 'skipped', reason: 'invalid' }
    if (error instanceof AuthDomainError && error.code === 'permission_denied')
        return { status: 'skipped', reason: 'permission' }
    if (error instanceof Error && 'code' in error) {
        if (error.code === 'discovery_managed') return { status: 'skipped', reason: 'discovery' }
        if (
            [
                'domain_mismatch',
                'certificate_expired',
                'certificate_not_found',
                'invalid_input',
            ].includes(String(error.code))
        )
            return { status: 'skipped', reason: 'invalid' }
    }
    return { status: 'failed', reason: 'unavailable' }
}

export function createBulkHostServices(dependencies: BulkHostDependencies) {
    async function run(input: unknown, apply: boolean): Promise<BulkHostResult> {
        const parsed = apply ? bulkHostApplySchema.parse(input) : bulkHostPreviewSchema.parse(input)
        const { kind, action } = parsed
        const required = bulkHostPermissions(kind, action)
        const actor = await dependencies.authorize(required[0]!)
        const targets =
            'hosts' in parsed ? parsed.hosts : parsed.hostIds.map((id) => ({ id, version: null }))
        const operationId = randomUUID()
        const deadline = dependencies.now() + BULK_HOST_LIMITS.durationMs
        const rows = await dependencies.transaction(async (transaction) => {
            if (apply) await dependencies.lock(transaction)
            // Do not reveal labels for IDs whose host type is no longer readable.
            await dependencies.reauthorize(transaction, actor.id, required[0]!)
            const hosts = new Map(
                (
                    await dependencies.read(
                        transaction,
                        kind,
                        targets.map((target) => target.id),
                    )
                ).map((host) => [host.id, host]),
            )
            const initialTags = await dependencies.readTags(transaction, kind)
            const outcomes: BulkHostOutcome[] = []
            for (const target of targets) {
                const host = hosts.get(target.id)
                const base = { id: target.id, label: host?.domains[0] ?? null }
                if (dependencies.now() >= deadline) {
                    outcomes.push({ ...base, status: 'failed', reason: 'timeout' })
                    continue
                }
                const attempt = async (nested: AuthTransaction): Promise<BulkHostOutcome> => {
                    for (const permission of required)
                        await dependencies.reauthorize(nested, actor.id, permission)
                    if (!host) return { ...base, status: 'skipped', reason: 'missing' }
                    if (action.type === 'accessPolicy' && kind === 'redirect')
                        return { ...base, status: 'skipped', reason: 'unsupported' }
                    if (
                        'discovery' in host &&
                        host.discovery &&
                        action.type !== 'addTags' &&
                        action.type !== 'removeTags'
                    )
                        return { ...base, status: 'skipped', reason: 'discovery' }
                    if (action.type === 'addTags' || action.type === 'removeTags') {
                        try {
                            bulkHostTagIds(initialTags, host.id, action)
                        } catch {
                            return { ...base, status: 'skipped', reason: 'invalid' }
                        }
                    }
                    if (isUnchanged(host, initialTags, action))
                        return { ...base, status: 'unchanged' }
                    const version = versionFor(actor.id, host, initialTags, action)
                    if (apply && target.version !== version)
                        return { ...base, status: 'skipped', reason: 'conflict' }
                    await dependencies.validate(nested, host, action, !apply)
                    if (!apply) return { ...base, status: 'ready', version }
                    // Read current classification after previous savepoints, so the batch preserves every row.
                    const tags = await dependencies.readTags(nested, kind)
                    await dependencies.write(nested, kind, host, action, tags)
                    // Validate additions together with every earlier successful savepoint.
                    // Disabling only removes runtime state and must also repair invalid legacy state.
                    if (
                        action.type === 'enable' ||
                        action.type === 'certificate' ||
                        action.type === 'accessPolicy'
                    )
                        await dependencies.validateRuntime(nested)
                    await dependencies.audit(nested, {
                        actorUserId: actor.id,
                        actorKind: 'user',
                        action:
                            action.type === 'enable'
                                ? 'enable'
                                : action.type === 'disable'
                                  ? 'disable'
                                  : 'update',
                        resource: kind === 'proxy' ? 'proxy-host' : 'redirect-host',
                        targetId: host.id,
                        result: 'success',
                        metadata: {
                            operationId,
                            changedFields: [
                                action.type === 'certificate'
                                    ? 'certificate'
                                    : action.type === 'accessPolicy'
                                      ? 'accessPolicy'
                                      : action.type === 'enable' || action.type === 'disable'
                                        ? 'status'
                                        : 'tags',
                            ],
                        },
                    })
                    return { ...base, status: 'applied' }
                }
                try {
                    outcomes.push(await dependencies.savepoint(transaction, attempt))
                } catch (error) {
                    outcomes.push({ ...base, ...failure(error) })
                }
            }
            return outcomes
        }, !apply)
        const runtimeChanged =
            rows.some((row) => row.status === 'applied') &&
            action.type !== 'addTags' &&
            action.type !== 'removeTags'
        let runtimeStatus: BulkHostResult['runtimeStatus'] = 'unchanged'
        if (runtimeChanged) {
            try {
                runtimeStatus = await dependencies.reconcile(actor.id)
            } catch {
                runtimeStatus = 'pending'
            }
        }
        return { rows, runtimeStatus }
    }
    return {
        preview: (input: unknown) => run(input, false),
        apply: (input: unknown) => run(input, true),
    }
}
