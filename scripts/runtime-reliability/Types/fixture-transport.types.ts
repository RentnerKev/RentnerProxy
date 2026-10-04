export type FixturePorts = {
    primaryPort: number
    secondaryPort: number
    authPort: number
    controlPort: number
    tlsPort: number
}

export type FixtureControl =
    | { upstreamFailed: boolean }
    | { authMode: 'allow' | 'deny' | 'unavailable' }
    | { startTls: true }

export type TrafficObservation = {
    route: number | null
    status: number | null
    hostFetchCode: string | null
}

export type TransportFailureCategory =
    | 'tcp-dial-timeout'
    | 'tcp-dial-refused'
    | 'dns-lookup'
    | 'connection-reset'
    | 'unexpected-eof'
    | 'tls-failure'
    | 'response-timeout'
    | 'upstream-error'

export type TrafficDiagnostic = {
    stage: string
    failureCategory: string
    observation: TrafficObservation | null
    caddy: { category: TransportFailureCategory; status: number; newTcpDial: boolean }[]
    fixtureReachability: {
        primary: number | null
        secondary: number | null
        auth: number | null
        tls: number | null
    } | null
    fixtureRunning: boolean | null
    capture: 'complete' | 'partial'
}
