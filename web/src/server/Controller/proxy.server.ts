import '@tanstack/react-start/server-only'
import { z } from 'zod'

import type {
    ProxyConfigSource,
    ProxyRuntimeStatus,
} from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

import {
    MAX_RUNTIME_PAYLOAD_BYTES,
    PROXY_RUNTIME_REVISION_PATTERN,
} from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'
import type {
    ProxyRuntimeApplyResponse,
    ProxyRuntimeSnapshot,
} from '@/server/ProxyRuntime/Types/proxy-runtime.types.ts'

import { controllerRequest } from './transport.server.ts'
import { CONTROLLER_APPLY_TIMEOUT_MS } from '@/config/controller.config.ts'

const STATUS_TIMEOUT_MS = 2_000

const MAX_CONFIG_RESPONSE_BYTES = 32 * 1_024 * 1_024

const revisionSchema = z.string().regex(PROXY_RUNTIME_REVISION_PATTERN)

const timestampSchema = z
    .string()
    .max(40)
    .refine((value) => /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value)))
    .nullable()

const statusSchema = z.object({
    available: z.boolean(),
    running: z.boolean(),
    activeRevision: revisionSchema.nullable(),
    lastApplyAt: timestampSchema,
})

const applySchema = z.object({
    status: z.enum(['applied', 'unchanged']),
    activeRevision: revisionSchema,
    lastApplyAt: timestampSchema,
})

export async function getProxyRuntimeStatus(): Promise<ProxyRuntimeStatus | null> {
    const payload = await controllerRequest('/internal/v1/proxy/status', {
        timeoutMs: STATUS_TIMEOUT_MS,
        privileged: true,
    })
    const result = statusSchema.safeParse(payload)
    return result.success ? result.data : null
}

export async function applyProxyRuntimeConfiguration(
    snapshot: ProxyRuntimeSnapshot,
    timeoutMs = CONTROLLER_APPLY_TIMEOUT_MS,
): Promise<ProxyRuntimeApplyResponse | null> {
    const body = JSON.stringify(snapshot)
    if (Buffer.byteLength(body) > MAX_RUNTIME_PAYLOAD_BYTES || timeoutMs <= 0) return null

    const payload = await controllerRequest('/internal/v1/proxy/config', {
        timeoutMs: Math.min(timeoutMs, CONTROLLER_APPLY_TIMEOUT_MS),
        privileged: true,
        confidential: snapshot.proxyHosts.some(
            (host) => host.accessPolicy?.basicAuth !== undefined,
        ),
        body,
    })
    const result = applySchema.safeParse(payload)
    return result.success && result.data.activeRevision === snapshot.revision ? result.data : null
}

export async function getActiveProxyConfiguration(): Promise<ProxyConfigSource | null> {
    const payload = await controllerRequest('/internal/v1/proxy/config', {
        timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
        privileged: true,
        responseLimit: MAX_CONFIG_RESPONSE_BYTES,
    })
    const result = z
        .object({
            config: z.string().max(MAX_CONFIG_RESPONSE_BYTES),
            activeRevision: revisionSchema.nullable(),
        })
        .safeParse(payload)
    return result.success
        ? { config: result.data.config, revision: result.data.activeRevision }
        : null
}

export async function previewProxyConfiguration(
    snapshot: ProxyRuntimeSnapshot,
): Promise<ProxyConfigSource | null> {
    const body = JSON.stringify(snapshot)
    if (Buffer.byteLength(body) > MAX_RUNTIME_PAYLOAD_BYTES) return null
    const payload = await controllerRequest('/internal/v1/proxy/config/preview', {
        timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
        method: 'POST',
        privileged: true,
        confidential: snapshot.proxyHosts.some(
            (host) => host.accessPolicy?.basicAuth !== undefined,
        ),
        body,
        responseLimit: MAX_CONFIG_RESPONSE_BYTES,
    })
    const result = z
        .object({
            config: z.string().max(MAX_CONFIG_RESPONSE_BYTES),
            revision: revisionSchema,
        })
        .safeParse(payload)
    return result.success && result.data.revision === snapshot.revision ? result.data : null
}

const MAX_HOST_CONFIG_RESPONSE_BYTES = 512 * 1_024

export async function getActiveProxyHostConfiguration(
    proxyHostId: string,
): Promise<ProxyConfigSource | null> {
    const id = z.uuid().safeParse(proxyHostId)
    if (!id.success) return null
    const payload = await controllerRequest(
        `/internal/v1/proxy/hosts/${id.data.toLowerCase()}/config`,
        {
            timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
            privileged: true,
            responseLimit: MAX_HOST_CONFIG_RESPONSE_BYTES,
            allowNotFound: true,
        },
    )
    const result = z
        .object({
            config: z.string().max(MAX_HOST_CONFIG_RESPONSE_BYTES),
            activeRevision: revisionSchema.nullable(),
        })
        .safeParse(payload)
    return result.success
        ? { config: result.data.config, revision: result.data.activeRevision }
        : null
}

export async function previewProxyHostConfiguration(
    proxyHostId: string,
    snapshot: ProxyRuntimeSnapshot,
): Promise<ProxyConfigSource | null> {
    const id = z.uuid().safeParse(proxyHostId)
    if (!id.success) return null
    const body = JSON.stringify(snapshot)
    if (Buffer.byteLength(body) > MAX_RUNTIME_PAYLOAD_BYTES) return null
    const payload = await controllerRequest(
        `/internal/v1/proxy/hosts/${id.data.toLowerCase()}/config/preview`,
        {
            timeoutMs: CONTROLLER_APPLY_TIMEOUT_MS,
            privileged: true,
            method: 'POST',
            confidential: snapshot.proxyHosts.some(
                (host) => host.accessPolicy?.basicAuth !== undefined,
            ),
            body,
            responseLimit: MAX_HOST_CONFIG_RESPONSE_BYTES,
        },
    )
    const result = z
        .object({
            config: z.string().max(MAX_HOST_CONFIG_RESPONSE_BYTES),
            revision: revisionSchema,
        })
        .safeParse(payload)
    return result.success && result.data.revision === snapshot.revision ? result.data : null
}
