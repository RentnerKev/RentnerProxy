// oxlint-disable-next-line import/no-unassigned-import -- Keeps runtime hashing behind the server boundary.
import '@tanstack/react-start/server-only'

import { z } from 'zod'

import {
    proxyForwardHostSchema,
    proxyForwardPortSchema,
    proxyHostDomainsSchema,
} from '../../features/Admin/ProxyHostManagement/validation'
import type {
    ProxyRuntimeStatus,
    ProxyRuntimeSyncStatus,
} from '../../shared/Types/proxy-runtime.types'
import type { ProxyRuntimeHost, ProxyRuntimeSnapshot } from './Types/proxy-runtime.types'

export const MAX_RUNTIME_PROXY_HOSTS = 1_000
export const MAX_RUNTIME_PAYLOAD_BYTES = 16 * 1_024 * 1_024
export const PROXY_RUNTIME_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u

const runtimeHostSchema = z.object({
    id: z.uuid(),
    domains: proxyHostDomainsSchema,
    forwardScheme: z.enum(['http', 'https']),
    forwardHost: proxyForwardHostSchema,
    forwardPort: proxyForwardPortSchema,
})

function compareAscii(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0
}

// The property order here is part of the version 1 cross-language hash contract.
export function createProxyRuntimeSnapshot(
    hosts: ReadonlyArray<ProxyRuntimeHost & { readonly enabled: boolean }>,
): ProxyRuntimeSnapshot {
    const enabledHosts = hosts.filter((host) => host.enabled)

    if (enabledHosts.length > MAX_RUNTIME_PROXY_HOSTS) {
        throw new Error('Proxy runtime host limit exceeded.')
    }

    const ids = new Set<string>()
    const domains = new Set<string>()
    const proxyHosts = enabledHosts
        .map((input): ProxyRuntimeHost => {
            const host = runtimeHostSchema.parse(input)
            const id = host.id.toLowerCase()

            if (ids.has(id) || host.domains.some((domain) => domains.has(domain))) {
                throw new Error('Proxy runtime snapshot contains duplicate hosts or domains.')
            }

            ids.add(id)
            for (const domain of host.domains) domains.add(domain)

            return {
                id,
                domains: host.domains.toSorted(compareAscii),
                forwardScheme: host.forwardScheme,
                forwardHost: host.forwardHost,
                forwardPort: host.forwardPort,
            }
        })
        .toSorted((left, right) => compareAscii(left.id, right.id))
    const canonical = JSON.stringify({ version: 1, proxyHosts })

    if (Buffer.byteLength(canonical) + 100 > MAX_RUNTIME_PAYLOAD_BYTES) {
        throw new Error('Proxy runtime snapshot is too large.')
    }

    const revision = 'sha256:' + new Bun.CryptoHasher('sha256').update(canonical).digest('hex')
    return { version: 1, revision, proxyHosts }
}

export function compareProxyRuntimeStatus(
    desiredRevision: string,
    runtime: ProxyRuntimeStatus | null,
): ProxyRuntimeSyncStatus {
    const status = runtime ?? {
        available: false,
        running: false,
        activeRevision: null,
        lastApplyAt: null,
    }

    return {
        ...status,
        desiredRevision,
        state:
            !status.available || !status.running
                ? 'unavailable'
                : status.activeRevision === desiredRevision
                  ? 'synced'
                  : 'pending',
    }
}
