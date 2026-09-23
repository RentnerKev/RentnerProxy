import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader, setResponseStatus } from '@tanstack/react-start/server'

import { CrowdSecDomainError } from '../../../server/Admin/CrowdSec/crowdsec.errors'
import {
    getCrowdSecConfigurationService,
    testCrowdSecConnectionService,
    updateCrowdSecConfigurationService,
} from '../../../server/Admin/CrowdSec/crowdsec.service'
import { localizedActionFailure, throwLocalizedQueryError } from '../../Auth/serverHelpers'
import { testCrowdSecConnectionSchema, updateCrowdSecConfigurationSchema } from './validation'

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
} as const

function crowdSecActionFailure(error: unknown) {
    if (error instanceof CrowdSecDomainError) {
        setResponseStatus(
            error.code === 'configuration_conflict'
                ? 409
                : error.code === 'controller_unavailable' ||
                    error.code === 'configuration_unavailable'
                  ? 503
                  : error.code === 'connection_failed'
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
