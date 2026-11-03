import { beforeEach, describe, expect, test } from 'bun:test'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { AccessPolicyDomainError } from '@/server/Admin/AccessPolicyManagement/access-policies.errors.ts'
import { BasicAuthDomainError } from '@/server/Admin/AccessPolicyManagement/basic-auth.errors.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/AccessPolicyManagement/access-policies.service.ts', [
    'createAccessPolicyService',
    'deleteAccessPolicyService',
    'getAccessPoliciesService',
    'getAssignableAccessPoliciesService',
    'updateAccessPolicyService',
    'searchAccessPoliciesService',
])
boundary.mockServices('@/server/Admin/AccessPolicyManagement/basic-auth.service.ts', [
    'createBasicAuthAccountService',
    'deleteBasicAuthAccountService',
    'getBasicAuthAccountsService',
    'updateBasicAuthAccountService',
])
boundary.mockServices('@/server/ProxyRuntime/proxy-runtime.service.ts', [
    'applyProxyConfigurationService',
    'getProxyRuntimeStatusService',
])
const handlers = await import('@/features/Admin/AccessPolicyManagement/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
beforeEach(() => boundary.reset())

describe('access policy request boundary', () => {
    test.each([
        [
            handlers.createAccessPolicyHandler,
            'createAccessPolicyService',
            { name: 'Public fixture', mode: 'public' },
            'created',
        ],
        [
            handlers.updateAccessPolicyHandler,
            'updateAccessPolicyService',
            { accessPolicyId: id, name: 'Updated fixture' },
            'updated',
        ],
        [
            handlers.deleteAccessPolicyHandler,
            'deleteAccessPolicyService',
            { accessPolicyId: id },
            'deleted',
        ],
        [
            handlers.createBasicAuthAccountHandler,
            'createBasicAuthAccountService',
            { accessPolicyId: id, username: 'fixture', password: 'fixture-password' },
            'created',
        ],
        [
            handlers.updateBasicAuthAccountHandler,
            'updateBasicAuthAccountService',
            { accessPolicyId: id, accountId: id, username: 'renamed-fixture' },
            'updated',
        ],
        [
            handlers.deleteBasicAuthAccountHandler,
            'deleteBasicAuthAccountService',
            { accessPolicyId: id, accountId: id },
            'deleted',
        ],
    ])(
        'distinguishes applied and pending results from %s',
        async (handler, service, input, action) => {
            for (const runtimeStatus of ['applied', 'pending']) {
                boundary.values.set(service, { runtimeStatus })
                const prefix = service.includes('BasicAuth')
                    ? 'admin.accessPolicies.basicAuth.messages.'
                    : 'admin.accessPolicies.messages.'
                // oxlint-disable-next-line no-await-in-loop -- Each outcome changes the shared boundary fixture.
                expect(await boundary.invoke(handler, input)).toMatchObject({
                    success: true,
                    runtimeStatus,
                    message: prefix + (runtimeStatus === 'pending' ? 'savedPending' : action),
                })
            }
            expect(boundary.argumentsFor(service).length).toBe(2)
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            boundary.failures.set(service, new Error('fixture-private detail'))
            expect(await boundary.invoke(handler, input)).toMatchObject({ success: false })
        },
    )

    test.each([
        ['access_policy_not_found', 404],
        ['access_policy_in_use', 409],
        ['controller_unavailable', 503],
        ['invalid_input', 400],
    ] as const)('maps policy error %s to HTTP %s', async (code, status) => {
        boundary.failures.set('deleteAccessPolicyService', new AccessPolicyDomainError(code))
        expect(
            await boundary.invoke(handlers.deleteAccessPolicyHandler, { accessPolicyId: id }),
        ).toEqual({ success: false, message: `admin.accessPolicies.errors.${code}` })
        expect(boundary.status).toBe(status)
    })

    test.each([
        ['basic_auth_account_not_found', 404],
        ['basic_auth_username_conflict', 409],
        ['basic_auth_account_limit', 409],
        ['invalid_input', 422],
    ] as const)('maps Basic Auth error %s without leaking secrets', async (code, status) => {
        boundary.failures.set('deleteBasicAuthAccountService', new BasicAuthDomainError(code))
        expect(
            await boundary.invoke(handlers.deleteBasicAuthAccountHandler, {
                accessPolicyId: id,
                accountId: id,
            }),
        ).toEqual({ success: false, message: `admin.accessPolicies.basicAuth.errors.${code}` })
        expect(boundary.status).toBe(status)
    })

    test.each([
        [handlers.getAccessPoliciesHandler, 'getAccessPoliciesService', undefined],
        [
            handlers.getAssignableAccessPoliciesHandler,
            'getAssignableAccessPoliciesService',
            undefined,
        ],
        [
            handlers.getBasicAuthAccountsHandler,
            'getBasicAuthAccountsService',
            { accessPolicyId: id },
        ],
        [handlers.getAccessPolicyRuntimeStatusHandler, 'getProxyRuntimeStatusService', undefined],
    ])('keeps %s queries uncached and localizes failures', async (handler, service, input) => {
        boundary.values.set(service, [])
        expect(await boundary.invoke(handler, input)).toEqual([])
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
        boundary.failures.set(service, new Error('private fixture detail'))
        await expect(boundary.invoke(handler, input)).rejects.toThrow()
    })

    test('checks apply permission before reconfiguration and view permission before search', async () => {
        boundary.failures.set('requirePermissionService', new Error('denied'))
        expect(await boundary.invoke(handlers.applyAccessPolicyConfigurationHandler)).toMatchObject(
            { success: false },
        )
        await expect(
            boundary.invoke(handlers.searchAccessPoliciesHandler, { query: 'fixture' }),
        ).rejects.toThrow()
        expect(boundary.argumentsFor('applyProxyConfigurationService')).toEqual([])
        expect(boundary.argumentsFor('searchAccessPoliciesService')).toEqual([])
        boundary.failures.clear()
        boundary.calls.length = 0
        boundary.values.set('applyProxyConfigurationService', 'applied')
        expect(await boundary.invoke(handlers.applyAccessPolicyConfigurationHandler)).toMatchObject(
            { success: true },
        )
        expect(boundary.argumentsFor('requirePermissionService')).toEqual([
            [PERMISSIONS.ACCESS_POLICIES_APPLY],
        ])
        expect(boundary.argumentsFor('applyProxyConfigurationService')).toEqual([
            [PERMISSIONS.ACCESS_POLICIES_APPLY],
        ])
        boundary.values.set('applyProxyConfigurationService', 'pending')
        expect(await boundary.invoke(handlers.applyAccessPolicyConfigurationHandler)).toMatchObject(
            { success: false },
        )
    })
})
