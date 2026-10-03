import type { UpstreamTlsSettings, ExistingProxyHost } from './Types/upstream-tls.types.ts'
import '@tanstack/react-start/server-only'

import { isIP } from 'node:net'

import type {
    CreateProxyHostInput,
    UpdateProxyHostInput,
} from '@/features/Admin/ProxyHostManagement/Types/validation.types.ts'
import { ProxyHostDomainError } from './proxy-hosts.errors.ts'

export function normalizeUpstreamTlsSettings(
    input: CreateProxyHostInput | UpdateProxyHostInput,
    existing?: ExistingProxyHost,
): UpstreamTlsSettings {
    if (input.forwardScheme === 'http') {
        return { verifyUpstreamTls: true, upstreamTlsServerName: null, trustedCaId: null }
    }
    const preservesHttpsSettings = existing?.forwardScheme === 'https'
    const verifyUpstreamTls =
        input.verifyUpstreamTls ?? (preservesHttpsSettings ? existing.verifyUpstreamTls : true)
    const upstreamTlsServerName =
        input.upstreamTlsServerName === undefined && preservesHttpsSettings
            ? existing.upstreamTlsServerName
            : (input.upstreamTlsServerName ?? null)
    const trustedCaId =
        input.trustedCaId === undefined && preservesHttpsSettings
            ? existing.trustedCaId
            : (input.trustedCaId?.toLowerCase() ?? null)

    if (trustedCaId !== null && !verifyUpstreamTls) throw invalidInput()
    if (verifyUpstreamTls && isIP(input.forwardHost) !== 0 && upstreamTlsServerName === null)
        throw invalidInput()
    return { verifyUpstreamTls, upstreamTlsServerName, trustedCaId }
}

function invalidInput(): ProxyHostDomainError {
    return new ProxyHostDomainError('invalid_input', 'Proxy host input is invalid.')
}
