import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { ddnsBatchSchema, ddnsSnapshotSchema } from '@/lib/Ddns/validation.ts'
import { ddnsFingerprint } from '@/lib/Ddns/targets.ts'
import { DDNS_ACTION_ERRORS, DdnsDomainError } from '@/server/Admin/Ddns/ddns.errors.ts'
import type { DdnsController, DdnsControllerRequest } from './Types/ddns.types.ts'
import { controllerRequest } from './transport.server.ts'

const failureSchema = z.strictObject({
    error: z.enum(DDNS_ACTION_ERRORS),
    retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
})
function decode<T>(payload: unknown, schema: z.ZodType<T>): T {
    const failure = failureSchema.safeParse(payload)
    if (failure.success)
        throw new DdnsDomainError(failure.data.error, failure.data.retryAfterSeconds)
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new DdnsDomainError('controller_unavailable')
    return parsed.data
}
export function createDdnsController(
    request: DdnsControllerRequest = controllerRequest,
): DdnsController {
    const options = {
        privileged: true,
        confidential: true,
        timeoutMs: 30_000,
        responseLimit: 1_048_576,
        acceptNonOkJson: true,
    } as const
    async function action(
        path: 'enable' | 'disable',
        input: Parameters<DdnsController['enable']>[0],
    ) {
        const result = decode(
            await request(`/internal/v1/ddns/${path}`, {
                ...options,
                method: 'POST',
                body: JSON.stringify(input),
            }),
            ddnsSnapshotSchema,
        )
        if (
            result.configuration?.revision !== input.expectedRevision + 1 ||
            result.configuration.updatedByUserId !== input.actorUserId ||
            result.configuration.settings.enabled !== (path === 'enable')
        )
            throw new DdnsDomainError('controller_unavailable')
        return result
    }
    return {
        async status() {
            return decode(await request('/internal/v1/ddns/status', options), ddnsSnapshotSchema)
        },
        async preview(input) {
            const result = decode(
                await request('/internal/v1/ddns/preview', {
                    ...options,
                    method: 'POST',
                    body: JSON.stringify(input),
                }),
                ddnsBatchSchema,
            )
            if (
                !result.preview ||
                result.targets.length !== input.targets.length ||
                new Set(result.targets.map((target) => target.targetId)).size !==
                    input.targets.length ||
                result.targets.some(
                    (target) => !input.targets.some((selected) => selected.id === target.targetId),
                )
            )
                throw new DdnsDomainError('controller_unavailable')
            return result
        },
        async save(input) {
            const result = decode(
                await request('/internal/v1/ddns/config', {
                    ...options,
                    method: 'PUT',
                    body: JSON.stringify(input),
                }),
                ddnsSnapshotSchema,
            )
            if (
                result.configuration?.revision !== input.expectedRevision + 1 ||
                result.configuration.updatedByUserId !== input.actorUserId ||
                result.configuration.settings.enabled !== input.configuration.enabled ||
                ddnsFingerprint(result.configuration.settings) !==
                    ddnsFingerprint(input.configuration)
            )
                throw new DdnsDomainError('controller_unavailable')
            return result
        },
        enable: (input) => action('enable', input),
        disable: (input) => action('disable', input),
        async sync(input) {
            const result = decode(
                await request('/internal/v1/ddns/sync', {
                    ...options,
                    method: 'POST',
                    body: JSON.stringify(input),
                }),
                ddnsBatchSchema,
            )
            if (result.preview) throw new DdnsDomainError('controller_unavailable')
            return result
        },
    }
}
export const ddnsController = createDdnsController()
