import { describe, expect, test } from 'bun:test'
import { getProxyHostFormValues } from '@/lib/Admin/ProxyHostManagement/proxyHostFormValues.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import { UPSTREAM_FAILOVER_DEFAULTS } from '@/config/upstream-pools.config.ts'

const source: ProxyHostSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54019',
    domains: ['old.example.com', 'alias.example.com'],
    forwardScheme: 'https',
    forwardHost: 'upstream.internal',
    forwardPort: 8443,
    enabled: false,
    certificateId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54022',
    forceHttps: true,
    verifyUpstreamTls: true,
    upstreamTlsServerName: 'tls.internal',
    trustedCaId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54023',
    accessPolicyId: '00000000-0000-4000-8000-000000000004',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('proxy host form drafts', () => {
    test('duplicates only ordinary form settings with blank independent domains', () => {
        const original = structuredClone(source)
        const draft = getProxyHostFormValues('duplicate', source)
        expect(draft).toEqual({
            responseCompression: null,
            responseCache: null,
            domains: [''],
            forwardScheme: 'https',
            forwardHost: source.forwardHost,
            forwardPort: '8443',
            upstreamPool: null,
            enabled: false,
            certificateId: source.certificateId,
            forceHttps: true,
            verifyUpstreamTls: true,
            upstreamTlsServerName: source.upstreamTlsServerName,
            trustedCaId: source.trustedCaId,
            accessPolicyId: source.accessPolicyId,
        })
        draft.domains.push('new.example.com')
        expect(source).toEqual(original)
        expect(draft).not.toHaveProperty('id')
        expect(draft).not.toHaveProperty('createdAt')
        expect(draft).not.toHaveProperty('certificateJob')
    })
    test('editing copies domains and an ordinary create ignores any previous source', () => {
        const editing = getProxyHostFormValues('edit', source)
        expect(editing.domains).toEqual(source.domains)
        expect(editing.domains).not.toBe(source.domains)
        expect(getProxyHostFormValues('create', source)).toEqual(getProxyHostFormValues('create'))
        expect(getProxyHostFormValues('create').forwardHost).toBe('')
    })
    test('edit and duplicate preserve ordered pools without sharing member objects', () => {
        const pooled: ProxyHostSummary = {
            ...source,
            upstreamPool: {
                policy: 'first',
                members: [
                    { host: 'primary.internal', port: 8080 },
                    { host: 'secondary.internal', port: 9090 },
                ],
            },
        }
        for (const mode of ['edit', 'duplicate'] as const) {
            const draft = getProxyHostFormValues(mode, pooled)
            expect(draft.forwardHost).toBe('primary.internal')
            expect(draft.forwardPort).toBe('8080')
            expect(draft.upstreamPool).toEqual({
                policy: 'first',
                members: [
                    { host: 'primary.internal', port: '8080' },
                    { host: 'secondary.internal', port: '9090' },
                ],
            })
            draft.upstreamPool!.members[0]!.host = 'changed.internal'
            draft.upstreamPool!.members.reverse()
            expect(pooled.upstreamPool!.members[0]!.host).toBe('primary.internal')
        }
        expect(getProxyHostFormValues('create', pooled).upstreamPool).toBeNull()
    })
    test('copies every failover section into independent string drafts for edit and duplicate', () => {
        const pooled: ProxyHostSummary = {
            ...source,
            upstreamPool: {
                policy: 'first',
                members: [{ host: source.forwardHost, port: source.forwardPort }],
                failover: structuredClone(UPSTREAM_FAILOVER_DEFAULTS),
            },
        }
        for (const mode of ['edit', 'duplicate'] as const) {
            const draft = getProxyHostFormValues(mode, pooled)
            const failover = draft.upstreamPool!.failover!
            expect(failover).toEqual({
                active: {
                    path: '/health',
                    intervalSeconds: '10',
                    timeoutSeconds: '2',
                    fails: '2',
                    passes: '2',
                    expectedStatus: '200',
                },
                passive: { failDurationSeconds: '30', maxFails: '1' },
                retries: {
                    maxRetries: '2',
                    tryDurationSeconds: '5',
                    tryIntervalMilliseconds: '250',
                },
            })
            failover.active!.path = '/changed'
            failover.passive!.maxFails = '5'
            failover.retries!.maxRetries = '7'
            expect(pooled.upstreamPool!.failover).toEqual(UPSTREAM_FAILOVER_DEFAULTS)
        }
    })
})
