import type { CONTROLLER_SERVICE } from '@/config/controller.config.ts'

export type ControllerHealthPayload = Readonly<{
    status: 'ok'
    service: typeof CONTROLLER_SERVICE
    version?: string
}>
