import '@tanstack/react-start/server-only'
import { getRequest, getRequestIP } from '@tanstack/react-start/server'
import { isIP } from 'node:net'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import { getTrustProxyHeaders } from '@/server/env.server.ts'

/** Canonicalizes a literal address without accepting ports, hostnames or interface scopes. */
function normalizeAddress(address: string | undefined): string | null {
    if (!address || address.includes('%') || !isIP(address)) return null
    return address.includes(':') ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address
}

/**
 * Uses the existing deployment opt-in for one trusted proxy hop. Enabling it requires
 * isolating management behind a proxy that overwrites or appends its observed peer to XFF.
 */
export function resolveOidcClientIp(
    request: Request,
    peerAddress: string | undefined,
    trustProxyHeaders: boolean,
): string {
    const peer = normalizeAddress(peerAddress)
    if (!peer) return 'unknown'
    if (!trustProxyHeaders) return peer

    const header = request.headers.get('x-forwarded-for')
    if (
        !header ||
        header.length > OIDC_LIMITS.forwardedForHeaderBytes ||
        Buffer.byteLength(header, 'utf8') > OIDC_LIMITS.forwardedForHeaderBytes
    )
        return peer

    // Trust only the nearest proxy's observation, never a caller-controlled chain prefix.
    const forwarded = header.slice(header.lastIndexOf(',') + 1).trim()
    return normalizeAddress(forwarded) ?? peer
}

/** Resolves the raw OIDC route's active TanStack request using strict deployment trust. */
export function getOidcClientIp(): string {
    return resolveOidcClientIp(getRequest(), getRequestIP(), getTrustProxyHeaders())
}
