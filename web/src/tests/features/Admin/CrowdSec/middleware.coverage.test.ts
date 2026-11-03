import { beforeEach, expect, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { CrowdSecDomainError } from '@/server/Admin/CrowdSec/crowdsec.errors.ts'
const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/CrowdSec/crowdsec.service.ts', [
    'getCrowdSecConfigurationService',
    'getCrowdSecDashboardService',
    'enrollCrowdSecConsoleService',
    'testCrowdSecConnectionService',
    'updateCrowdSecConfigurationService',
])
boundary.mockServices('@/server/ForwardAuth/forward-auth-summary.service.ts', [
    'getForwardAuthSummaryService',
])
const handlers = await import('@/features/Admin/CrowdSec/middleware.ts')
beforeEach(() => boundary.reset())

test.each([
    [
        handlers.getCrowdSecConfigurationHandler,
        'getCrowdSecConfigurationService',
        undefined,
        'admin.crowdSec.errors.loadFailed',
    ],
    [
        handlers.getForwardAuthSummaryHandler,
        'getForwardAuthSummaryService',
        undefined,
        'admin.accessPolicies.errors.loadFailed',
    ],
    [
        handlers.getCrowdSecDashboardHandler,
        'getCrowdSecDashboardService',
        { offset: 0, limit: 20, search: '', origin: '', scope: '' },
        'admin.crowdSec.dashboard.unavailable',
    ],
])(
    'CrowdSec queries use private no-store responses and sanitize service failures',
    async (handler, service, input, fallback) => {
        boundary.values.set(service, { fixture: service })
        expect(await boundary.invoke(handler, input)).toEqual({ fixture: service })
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
        expect(boundary.methods.get(handler)).toBe('GET')
        if (input) expect(boundary.argumentsFor(service)).toEqual([[{ ...input, country: '' }]])
        boundary.failures.set(service, new Error('private controller URL'))
        await expect(boundary.invoke(handler, input)).rejects.toThrow(fallback)
    },
)

test('CrowdSec mutations validate before service calls and preserve enrollment and configuration arguments', async () => {
    await expect(
        boundary.invoke(handlers.testCrowdSecConnectionHandler, {
            apiUrl: 'http://public.example',
        }),
    ).rejects.toThrow()
    expect(boundary.calls).toHaveLength(0)
    const connection = {
        apiUrl: 'https://crowdsec.example',
        apiKey: 'fixture-key-'.repeat(3),
    }
    expect(await boundary.invoke(handlers.testCrowdSecConnectionHandler, connection)).toMatchObject(
        { success: true },
    )
    expect(boundary.argumentsFor('testCrowdSecConnectionService')).toEqual([[connection]])
    const enrollment = { enrollmentKey: 'fixture-enrollment-key' }
    expect(await boundary.invoke(handlers.enrollCrowdSecConsoleHandler, enrollment)).toMatchObject({
        success: true,
        message: 'admin.crowdSec.messages.enrollmentPending',
    })
    expect(boundary.argumentsFor('enrollCrowdSecConsoleService')).toEqual([[enrollment]])
    boundary.values.set('updateCrowdSecConfigurationService', { runtimeStatus: 'pending' })
    expect(
        await boundary.invoke(handlers.updateCrowdSecConfigurationHandler, { mode: 'managed' }),
    ).toMatchObject({ success: true, message: 'admin.crowdSec.messages.savedPending' })
    boundary.values.set('updateCrowdSecConfigurationService', { runtimeStatus: 'applied' })
    expect(
        await boundary.invoke(handlers.updateCrowdSecConfigurationHandler, { mode: 'disabled' }),
    ).toMatchObject({ success: true, message: 'admin.crowdSec.messages.saved' })
})

test.each([
    ['configuration_conflict', 409, 'configurationConflict'],
    ['controller_unavailable', 503, 'controllerUnavailable'],
    ['configuration_unavailable', 503, 'configurationUnavailable'],
    ['connection_failed', 502, 'connectionFailed'],
    ['enrollment_failed', 502, 'enrollmentFailed'],
    ['invalid_input', 422, 'invalidInput'],
    ['api_key_required', 422, 'apiKeyRequired'],
    ['community_not_ready', 422, 'communityNotReady'],
] as const)(
    'CrowdSec maps %s to a sanitized status and localization key',
    async (code, status, key) => {
        boundary.failures.set('updateCrowdSecConfigurationService', new CrowdSecDomainError(code))
        expect(
            await boundary.invoke(handlers.updateCrowdSecConfigurationHandler, { mode: 'managed' }),
        ).toEqual({ success: false, message: `admin.crowdSec.errors.${key}` })
        expect(boundary.status).toBe(status)
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
    },
)

test('unexpected CrowdSec connection and enrollment errors use the action failure boundary', async () => {
    const failure = new Error('private service details')
    boundary.failures.set('testCrowdSecConnectionService', failure)
    boundary.failures.set('enrollCrowdSecConsoleService', failure)
    expect(
        await boundary.invoke(handlers.testCrowdSecConnectionHandler, {
            apiUrl: 'https://example.com',
        }),
    ).toEqual({ success: false, message: 'admin.crowdSec.errors.saveFailed' })
    expect(
        await boundary.invoke(handlers.enrollCrowdSecConsoleHandler, {
            enrollmentKey: 'fixture-enrollment-key',
        }),
    ).toEqual({ success: false, message: 'admin.crowdSec.errors.saveFailed' })
    expect(boundary.argumentsFor('localizedActionFailure')).toHaveLength(2)
})
