import { z } from 'zod'
import { readBoundedStream } from '@/lib/Http/readBoundedStream.ts'
import type { OidcConnections, OidcConnectionAction } from './Types/oidc-connections.types.ts'

const connectionsSchema = z
    .strictObject({
        revision: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER - 1),
        externallyManaged: z.boolean(),
        providers: z
            .array(
                z.strictObject({
                    id: z.uuid(),
                    name: z.string().min(1).max(255),
                    enabled: z.boolean(),
                    linked: z.boolean(),
                }),
            )
            .max(16),
    })
    .refine(
        (value) =>
            new Set(value.providers.map((provider) => provider.id)).size === value.providers.length,
    )

export class OidcConnectionsError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}

async function requestConnections(
    signal: AbortSignal,
    action?: OidcConnectionAction,
): Promise<unknown> {
    const response = await fetch('/api/auth/oidc/connections', {
        method: action ? 'POST' : 'GET',
        credentials: 'same-origin',
        mode: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: action ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
        body: action
            ? JSON.stringify({
                  providerId: action.providerId,
                  expectedRevision: action.expectedRevision,
              })
            : null,
        signal,
    })
    if (response.status === 401) throw new OidcConnectionsError('authentication_required')
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body)
        throw new OidcConnectionsError('invalid_response')
    const bytes = await readBoundedStream(response.body, 32_768, signal)
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!response.ok) {
        const error = z.strictObject({ error: z.string().max(100) }).safeParse(value)
        throw new OidcConnectionsError(error.success ? error.data.error : 'invalid_response')
    }
    return value
}

export async function getOidcConnections(signal: AbortSignal): Promise<OidcConnections> {
    return connectionsSchema.parse(await requestConnections(signal))
}

export async function unlinkOidcConnection(
    action: OidcConnectionAction,
    signal: AbortSignal,
): Promise<void> {
    z.strictObject({ success: z.literal(true) }).parse(await requestConnections(signal, action))
}

export function getOidcConnectionsErrorKey(error: unknown): string {
    const code = error instanceof OidcConnectionsError ? error.code : null
    if (code === 'configuration_conflict') return 'account.oidc.error.conflict'
    if (code === 'reauthentication_required') return 'account.oidc.error.reauthenticate'
    if (code === 'identity_not_allowed' || code === 'permission_denied')
        return 'account.oidc.error.denied'
    if (code === 'rate_limited') return 'account.oidc.error.rateLimited'
    return 'account.oidc.error.failed'
}
