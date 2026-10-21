import { describe, expect, test } from 'bun:test'
import { hostListQuerySchema } from '@/features/Admin/HostTags/validation.ts'
import { filterHostPage } from '@/lib/HostTags/hostList.ts'
import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'

const infra = { id: '00000000-0000-4000-8000-000000000001', name: 'Büro' }
const privateTag = { id: '00000000-0000-4000-8000-000000000002', name: 'Privat' }
const tags = [infra, privateTag]
const hosts: ProxyHostSummary[] = Array.from({ length: 25 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
    domains: [`app${index}.example.com`],
    tags: index < 21 ? [infra, ...(index < 5 ? [privateTag] : [])] : [],
    forwardScheme: 'http',
    forwardHost: 'upstream.internal',
    forwardPort: 8080,
    enabled: index < 22,
    certificateId: null,
    forceHttps: false,
    verifyUpstreamTls: true,
    upstreamTlsServerName: null,
    trustedCaId: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...(index === 0 ? { discovery: { state: 'managed' as const } } : {}),
}))
const labels = { enabled: 'Aktiviert', disabled: 'Deaktiviert' }

describe('server host list filtering and pagination', () => {
    test('filters before pagination, counts hosts once, and uses stable ordering across pages', () => {
        const query = hostListQuerySchema.parse({ filters: [{ id: 'tags', value: infra.id }] })
        const first = filterHostPage(hosts, tags, query, labels)
        const second = filterHostPage(hosts, tags, { ...query, pageIndex: 1 }, labels)
        const last = filterHostPage(hosts, tags, { ...query, pageIndex: 2 }, labels)
        expect(first.total).toBe(21)
        expect(first.hosts).toHaveLength(10)
        expect(second.hosts).toHaveLength(10)
        expect(last.hosts).toHaveLength(1)
        expect(
            new Set([...first.hosts, ...second.hosts, ...last.hosts].map((host) => host.id)).size,
        ).toBe(21)
        expect(filterHostPage(hosts, tags, { ...query, pageIndex: 3 }, labels).hosts).toEqual([])
    })
    test('combines tags, localized search, status, domain and inclusive UTC date ranges', () => {
        const query = hostListQuerySchema.parse({
            locale: 'de',
            search: 'BÜRO',
            filters: [
                { id: 'tags', value: infra.id },
                { id: 'domains', value: 'app0.example.com' },
                { id: 'status', value: 'enabled' },
                { id: 'createdAt', value: { from: '2026-10-01', to: '2026-10-01' } },
            ],
        })
        const result = filterHostPage(hosts, tags, query, labels)
        expect(result.total).toBe(1)
        expect(result.hosts[0]?.discovery?.state).toBe('managed')
        expect(
            filterHostPage(
                hosts,
                tags,
                hostListQuerySchema.parse({ locale: 'de', search: 'Deaktiviert' }),
                labels,
            ).total,
        ).toBe(3)
        expect(filterHostPage(hosts, tags, { ...query, search: 'missing' }, labels).total).toBe(0)
    })
    test('keeps untagged hosts functional and groups multi-tag hosts without duplicating rows', () => {
        expect(
            filterHostPage(
                hosts,
                tags,
                hostListQuerySchema.parse({ filters: [{ id: 'tags', value: 'untagged' }] }),
                labels,
            ).total,
        ).toBe(4)
        const grouped = filterHostPage(
            hosts,
            tags,
            hostListQuerySchema.parse({ pageSize: 100, sorting: [{ id: 'tags', desc: false }] }),
            labels,
        )
        expect(grouped.hosts.slice(0, 4).every((host) => !host.tags?.length)).toBe(true)
        expect(new Set(grouped.hosts.map((host) => host.id)).size).toBe(25)
        const oldHost = { ...hosts[0]! }
        delete oldHost.tags
        expect(filterHostPage([oldHost], [], hostListQuerySchema.parse({}), labels).total).toBe(1)
    })
    test('returns only metadata from the authorized input scope, including empty and forged tag filters', () => {
        const visible = hosts.slice(0, 2)
        const result = filterHostPage(visible, [infra], hostListQuerySchema.parse({}), labels)
        expect(result.domains).toEqual(['app0.example.com', 'app1.example.com'])
        expect(result.tags).toEqual([infra])
        expect(result.total).toBe(2)
        expect(
            filterHostPage(
                visible,
                [infra],
                hostListQuerySchema.parse({
                    filters: [{ id: 'tags', value: crypto.randomUUID() }],
                }),
                labels,
            ).total,
        ).toBe(0)
        expect(filterHostPage([], [], hostListQuerySchema.parse({}), labels)).toEqual({
            hosts: [],
            domains: [],
            tags: [],
            total: 0,
        })
    })
    test('applies the same tag model to redirect hosts alongside destination, status code and certificate filters', () => {
        const redirect: RedirectHostSummary = {
            id: hosts[0]!.id,
            domains: ['redirect.example.com'],
            tags: [infra],
            destination: 'https://example.com/Archive',
            statusCode: 308,
            preserveRequestUri: true,
            certificateId: null,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        }
        const query = hostListQuerySchema.parse({
            search: 'archive',
            filters: [
                { id: 'tags', value: infra.id },
                { id: 'destination', value: 'ARCHIVE' },
                { id: 'statusCode', value: '308' },
                { id: 'certificate', value: 'http' },
            ],
        })
        expect(filterHostPage([redirect], tags, query, labels).total).toBe(1)
        expect(
            filterHostPage([redirect], tags, { ...query, search: 'internal' }, labels).total,
        ).toBe(0)
    })
})
