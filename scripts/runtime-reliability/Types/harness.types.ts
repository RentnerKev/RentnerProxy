import type { ReliabilityOptions, ReliabilityCheck } from './control.types.ts'
import type { TrafficDiagnostic } from './fixture-transport.types.ts'

export type CommandOptions = {
    diagnostic?: 'pebble-problems'
    timeoutMs?: number
    stdin?: string
    env?: Record<string, string>
    acceptableExitCodes?: number[]
    includeStderr?: boolean
}

export type FixtureResult = Record<string, any>

export type ReliabilityContext = {
    source: ReliabilityOptions['source']
    noteKnownLimitation: (name: 'alpha6-binding-retry-needs-second-request') => void
    command: (args: string[], options?: CommandOptions) => Promise<string>
    docker: (args: string[], options?: CommandOptions) => Promise<string>
    fixture: (phase: string, extra?: Record<string, unknown>) => Promise<FixtureResult>
    controller: (path: string, body?: unknown) => Promise<{ status: number; body: FixtureResult }>
    waitFor: (predicate: () => Promise<boolean>, label: string, timeoutMs?: number) => Promise<void>
    check: (name: ReliabilityCheck['name'], label: string) => void
    synced: (result: FixtureResult) => Promise<void>
    restart: () => Promise<void>
    expireCertificateRetry: (id: string) => Promise<void>
    http: (
        domain?: string,
        path?: string,
        headers?: Record<string, string>,
        route?: number,
    ) => Promise<{ status: number; headers: Headers; body: FixtureResult }>
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
