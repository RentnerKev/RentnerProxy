import type { CONTROLLER_SERVICE } from '../controller.constants'

export type ControllerHealthPayload = Readonly<{
    status: 'ok'
    service: typeof CONTROLLER_SERVICE
    version?: string
}>
