import { describe, expect, test } from 'bun:test'
import { getProxyHostFormValues } from '@/lib/Admin/ProxyHostManagement/proxyHostFormValues.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'

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
    accessPolicyId: '018f2f52-7c1b-7cc0-9f3c-6a9952c54024',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

describe('proxy host form drafts', () => {
    test('duplicates only ordinary form settings with blank independent domains', () => {
        const original = structuredClone(source)
        const draft = getProxyHostFormValues('duplicate', source)
        expect(draft).toEqual({
            domains: [''],
            forwardScheme: 'https',
            forwardHost: source.forwardHost,
            forwardPort: '8443',
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
})
