import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'

import { CrowdSecDomainError } from '../../../server/Admin/CrowdSec/crowdsec.errors'
import {
    getCrowdSecConfigurationService,
    getCrowdSecDashboardService,
    enrollCrowdSecConsoleService,
    testCrowdSecConnectionService,
    updateCrowdSecConfigurationService,
} from '../../../server/Admin/CrowdSec/crowdsec.service'
import { localizedActionFailure, throwLocalizedQueryError } from '../../Auth/serverHelpers'
import {
    crowdSecConsoleEnrollmentSchema,
    crowdSecDashboardQuerySchema,
    testCrowdSecConnectionSchema,
    updateCrowdSecConfigurationSchema,
} from './validation'

function noStore(): void {
    setResponseHeader('Cache-Control', 'private, no-store')
}

const errorMessages = {
    invalid_input: 'admin.crowdSec.errors.invalidInput',
    api_key_required: 'admin.crowdSec.errors.apiKeyRequired',
    connection_failed: 'admin.crowdSec.errors.connectionFailed',
    controller_unavailable: 'admin.crowdSec.errors.controllerUnavailable',
    configuration_conflict: 'admin.crowdSec.errors.configurationConflict',
    configuration_unavailable: 'admin.crowdSec.errors.configurationUnavailable',
    community_not_ready: 'admin.crowdSec.errors.communityNotReady',
    enrollment_failed: 'admin.crowdSec.errors.enrollmentFailed',
} as const

function crowdSecActionFailure(error: unknown) {
    if (error instanceof CrowdSecDomainError) {
        setResponseStatus(
            error.code === 'configuration_conflict'
                ? 409
                : error.code === 'controller_unavailable' ||
                    error.code === 'configuration_unavailable'
                  ? 503
                  : error.code === 'connection_failed' || error.code === 'enrollment_failed'
                    ? 502
                    : 422,
        )
        return { success: false as const, message: errorMessages[error.code] }
    }
    return localizedActionFailure(error, 'admin.crowdSec.errors.saveFailed')
}

export const getCrowdSecConfigurationHandler = createServerFn({ method: 'GET' }).handler(
    async () => {
        noStore()
        try {
            return await getCrowdSecConfigurationService()
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.crowdSec.errors.loadFailed')
        }
    },
)

export const getCrowdSecDashboardHandler = createServerFn({ method: 'GET' })
    .validator(crowdSecDashboardQuerySchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            return await getCrowdSecDashboardService(data)
        } catch (error) {
            throwLocalizedQueryError(error, 'admin.crowdSec.dashboard.unavailable')
        }
    })

export const testCrowdSecConnectionHandler = createServerFn({ method: 'POST' })
    .validator(testCrowdSecConnectionSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            await testCrowdSecConnectionService(data)
            return { success: true as const, message: 'admin.crowdSec.messages.connectionValid' }
        } catch (error) {
            return crowdSecActionFailure(error)
        }
    })

export const updateCrowdSecConfigurationHandler = createServerFn({ method: 'POST' })
    .validator(updateCrowdSecConfigurationSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            const result = await updateCrowdSecConfigurationService(data)
            return {
                success: true as const,
                message:
                    result.runtimeStatus === 'pending'
                        ? 'admin.crowdSec.messages.savedPending'
                        : 'admin.crowdSec.messages.saved',
                ...result,
            }
        } catch (error) {
            return crowdSecActionFailure(error)
        }
    })

export const enrollCrowdSecConsoleHandler = createServerFn({ method: 'POST' })
    .validator(crowdSecConsoleEnrollmentSchema)
    .handler(async ({ data }) => {
        noStore()
        try {
            await enrollCrowdSecConsoleService(data)
            return { success: true as const, message: 'admin.crowdSec.messages.enrollmentPending' }
        } catch (error) {
            return crowdSecActionFailure(error)
        }
    })
