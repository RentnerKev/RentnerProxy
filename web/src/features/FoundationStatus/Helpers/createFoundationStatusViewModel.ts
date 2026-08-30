import type { Translate } from '../../../language/useTranslationStore'
import type { FoundationHealth } from '../../../shared/Types/health.types'
import type { FoundationStatusViewModel } from '../Types/foundation-status.types'

export default function createFoundationStatusViewModel(
    health: FoundationHealth,
    t: Translate,
): FoundationStatusViewModel {
    const controllerConnected = health.controller.state === 'connected'
    const databaseConnected = health.database.state === 'connected'
    const redisConnected = health.redis.state === 'connected'

    return {
        controllerConnected,
        services: [
            {
                label: t('foundation.services.web.label'),
                detail: t('foundation.services.web.detail'),
                value: t('foundation.running'),
                tone: 'positive',
            },
            {
                label: t('foundation.services.controller.label'),
                detail: t('foundation.services.controller.detail'),
                value: t(controllerConnected ? 'foundation.connected' : 'foundation.unavailable'),
                tone: controllerConnected ? 'positive' : 'warning',
            },
            {
                label: t('foundation.services.database.label'),
                detail: t('foundation.services.database.detail'),
                value: t(databaseConnected ? 'foundation.connected' : 'foundation.unavailable'),
                tone: databaseConnected ? 'positive' : 'warning',
            },
            {
                label: t('foundation.services.redis.label'),
                detail: t('foundation.services.redis.detail'),
                value: t(redisConnected ? 'foundation.connected' : 'foundation.unavailable'),
                tone: redisConnected ? 'positive' : 'warning',
            },
        ],
    }
}
