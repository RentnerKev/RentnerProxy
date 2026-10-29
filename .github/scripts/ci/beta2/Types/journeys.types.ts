import type { createBeta2WebContext } from '../web-context.ts'
import type { Beta2Receivers } from './receivers.types.ts'

export type Beta2WebContext = Awaited<ReturnType<typeof createBeta2WebContext>>

export interface Beta2JourneyInput {
    readonly receivers: Beta2Receivers
    readonly context: Beta2WebContext
    readonly httpPort: number
    readonly stateDirectory: string
    readonly restartController: () => Promise<void>
}

export interface Beta2ControllerInput {
    readonly runId: string
    readonly controllerToken: string
    readonly directory: string
    readonly providerUrl: string
    readonly ipv4Url: string
    readonly ipv6Url: string
    readonly httpPort: number
    readonly httpsPort: number
}
