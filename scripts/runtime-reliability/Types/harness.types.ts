import type { z } from 'zod'
import type {
    fixtureResultSchema,
    controllerBodySchema,
    backendBodySchema,
} from '../responses.validation.ts'
import type { ReliabilityCheck } from './control.types.ts'
import type { TrafficDiagnostic } from './fixture-transport.types.ts'

export type CommandOptions = {
    diagnostic?: 'pebble-problems'
    timeoutMs?: number
    stdin?: string
    env?: Record<string, string>
    acceptableExitCodes?: number[]
    includeStderr?: boolean
}

export type FixtureResult = z.output<typeof fixtureResultSchema>
type ControllerBody = z.output<typeof controllerBodySchema>
type BackendBody = z.output<typeof backendBodySchema>

export type ReliabilityContext = {
    command: (args: string[], options?: CommandOptions) => Promise<string>
    docker: (args: string[], options?: CommandOptions) => Promise<string>
    fixture: (phase: string, extra?: Record<string, unknown>) => Promise<FixtureResult>
    controller: (path: string, body?: unknown) => Promise<{ status: number; body: ControllerBody }>
    waitFor: (predicate: () => Promise<boolean>, label: string, timeoutMs?: number) => Promise<void>
    check: (name: ReliabilityCheck['name'], label: string) => void
    synced: (result: Pick<FixtureResult, 'desiredRevision'>) => Promise<void>
    restart: () => Promise<void>
    expireCertificateRetry: (id: string) => Promise<void>
    http: (
        domain?: string,
        path?: string,
        headers?: Record<string, string>,
        route?: number,
    ) => Promise<{ status: number; headers: Headers; body: BackendBody }>
    captureTrafficDiagnostic: (stage: string, category: string) => Promise<TrafficDiagnostic>
    recordTrafficFailure: (route: number | null, status: number | null) => void
    startFixtureTls: () => Promise<number>
    runId: string
    container: string
    network: string
    pebble: string
    domain: string
    temp: string
    tlsPort: number
    publicTlsPort: number
    http3Image: string
}
