import type { FoundationHealth } from '../../../shared/Types/health.types'
import type { FoundationStatusViewModel } from '../Types/foundation-status.types'

export default function createFoundationStatusViewModel(
    health: FoundationHealth,
): FoundationStatusViewModel {
    const controllerConnected = health.controller.state === 'connected'
    const databaseConnected = health.database.state === 'connected'
    const redisConnected = health.redis.state === 'connected'

    return {
        controllerConnected,
        services: [
            {
                label: 'Web Application',
                detail: 'Serving this foundation screen',
                value: 'Running',
                tone: 'positive',
            },
            {
                label: 'Controller',
                detail: 'Server-side health check',
                value: controllerConnected ? 'Connected' : 'Unavailable',
                tone: controllerConnected ? 'positive' : 'warning',
            },
            {
                label: 'Database',
                detail: 'Server-side PostgreSQL health check',
                value: databaseConnected ? 'Connected' : 'Unavailable',
                tone: databaseConnected ? 'positive' : 'warning',
            },
            {
                label: 'Redis',
                detail: 'Server-side Redis health check',
                value: redisConnected ? 'Connected' : 'Unavailable',
                tone: redisConnected ? 'positive' : 'warning',
            },
        ],
    }
}
