import { createServerEntry } from '@tanstack/react-start/server-entry'

import { SESSION_COOKIE_NAME } from '@/config/auth.config.ts'
import { createSessionService } from '@/server/Auth/Access/sessions.service.ts'
import type { ControllerCertificateMetadata } from '@/server/Controller/Types/certificates.types.ts'

export function buildValidCertificateMetadata(
    id: string,
    domains: readonly string[],
    overrides: Partial<ControllerCertificateMetadata> = {},
): ControllerCertificateMetadata {
    const now = Date.now()
    return {
        id,
        source: 'acme',
        environment: 'staging',
        domains: [...domains],
        status: 'valid',
        operation: 'idle',
        issuedAt: new Date(now - 3_600_000).toISOString(),
        expiresAt: new Date(now + 86_400_000).toISOString(),
        issuer: 'Certificate job fixture',
        fingerprint: 'sha256:' + 'a'.repeat(64),
        lastErrorCode: null,
        updatedAt: new Date(now).toISOString(),
        ...overrides,
    }
}

export async function runWithCertificateJobSession<T>(
    userId: string,
    operation: () => Promise<T>,
): Promise<T> {
    const session = await createSessionService(userId)
    let result: T | undefined
    let failure: unknown
    const handler = createServerEntry({
        fetch: async () => {
            try {
                result = await operation()
            } catch (error) {
                failure = error
            }
            return new Response(null, { status: failure ? 500 : 204 })
        },
    }).fetch
    await handler(
        new Request('http://localhost/', {
            headers: { cookie: `${SESSION_COOKIE_NAME}=${session.token}` },
        }),
        {},
    )
    if (failure) throw failure
    return result as T
}
