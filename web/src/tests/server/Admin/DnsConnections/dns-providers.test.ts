import { describe, expect, mock, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/config/Types/permissions-config.types.ts'
import {
    createDnsProvidersService,
    createDdnsProviderContextService,
} from '@/server/Admin/DnsConnections/dns-providers.service.ts'
import { DDNS_CONNECTION, ddnsSettings, ddnsSnapshot } from '@/tests/Helpers/ddnsFixture.ts'
import type { DnsProviderDescriptor } from '@/lib/DnsConnections/Types/dns-provider.types.ts'

const providers: readonly DnsProviderDescriptor[] = [
    {
        id: 'cloudflare',
        capabilities: {
            zoneDiscovery: true,
            txtCreate: true,
            txtCleanup: true,
            addressRecordTypes: ['A', 'AAAA'],
            proxyOptions: 'cloudflare',
        },
    },
]

describe('provider catalogue authorization', () => {
    test.each([
        ['connections', PERMISSIONS.DNS_CONNECTIONS_VIEW],
        ['ddns', PERMISSIONS.DDNS_MANAGE],
        ['certificates', PERMISSIONS.CERTIFICATES_ISSUE],
    ] as const)('authorizes %s before requesting metadata', async (purpose, permission) => {
        const fetchProviders = mock(async () => providers)
        const denied = createDnsProvidersService({
            authorize: async () => {
                throw new Error('denied')
            },
            providers: fetchProviders,
        })
        await expect(denied(purpose)).rejects.toThrow('denied')
        expect(fetchProviders).not.toHaveBeenCalled()
        const authorize = mock(async (_permission: PermissionKey) => {})
        const allowed = createDnsProvidersService({ authorize, providers: fetchProviders })
        expect(await allowed(purpose)).toEqual(providers)
        expect(authorize).toHaveBeenCalledWith(permission)
    })

    test('sanitizes unexpected backend failures', async () => {
        const get = createDnsProvidersService({
            authorize: async () => {},
            providers: async () => {
                throw new Error('private-token')
            },
        })
        await expect(get('connections')).rejects.toThrow('controller_unavailable')
    })
})

describe('DDNS provider context without connection-list permission', () => {
    test('exposes only provider identities already referenced by configured targets', async () => {
        const authorize = mock(async (_permission: PermissionKey) => {})
        const context = createDdnsProviderContextService({
            authorize,
            providers: async () => providers,
            status: async () => ddnsSnapshot(ddnsSettings()),
            connections: async () => [
                DDNS_CONNECTION,
                {
                    ...DDNS_CONNECTION,
                    id: '0198d98a-0000-7000-8000-000000000099',
                    name: 'private unrelated connection',
                },
            ],
        })
        expect(await context()).toEqual({
            providers,
            bindings: [{ connectionId: DDNS_CONNECTION.id, provider: 'cloudflare' }],
        })
        expect(authorize.mock.calls).toEqual([[PERMISSIONS.DDNS_MANAGE]])
    })

    test('denies unauthorized callers before either connection or target lookup', async () => {
        const connections = mock(async () => [DDNS_CONNECTION])
        const status = mock(async () => ddnsSnapshot())
        const context = createDdnsProviderContextService({
            authorize: async () => {
                throw new Error('denied')
            },
            providers: async () => providers,
            connections,
            status,
        })
        await expect(context()).rejects.toThrow('denied')
        expect(connections).not.toHaveBeenCalled()
        expect(status).not.toHaveBeenCalled()
    })

    test('returns no bindings for unconfigured targets and sanitizes read failures', async () => {
        const dependencies = {
            authorize: async () => {},
            providers: async () => providers,
            connections: async () => [DDNS_CONNECTION],
            status: async () => ddnsSnapshot(),
        }
        expect((await createDdnsProviderContextService(dependencies)()).bindings).toEqual([])
        await expect(
            createDdnsProviderContextService({
                ...dependencies,
                connections: async () => {
                    throw new Error('secret')
                },
            })(),
        ).rejects.toThrow('controller_unavailable')
    })
})
