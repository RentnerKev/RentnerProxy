import { isRecord } from '../../shared/Helpers/isRecord'
import { CONTROLLER_SERVICE } from './controller.constants'
import type { ControllerHealthPayload } from './Types/controller-health.types'

export function parseControllerHealth(value: unknown): ControllerHealthPayload | null {
    if (
        !isRecord(value) ||
        value.status !== 'ok' ||
        value.service !== CONTROLLER_SERVICE ||
        ('version' in value && (typeof value.version !== 'string' || value.version.length === 0))
    ) {
        return null
    }

    return typeof value.version === 'string'
        ? { status: 'ok', service: CONTROLLER_SERVICE, version: value.version }
        : { status: 'ok', service: CONTROLLER_SERVICE }
}
