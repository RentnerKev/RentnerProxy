export type StartupProbe = Readonly<{
    ok: boolean
    elapsedMs: number
}>

export type ApplianceStartupSmokeOptions = Readonly<{
    temporaryRoot: string
    entrypointFile: string
    compose: readonly string[]
    httpPort: number
    httpsPort: number
    managementPort: number
    hostDomain: string
    trafficMarker: string
    command: (args: string[], timeoutMs?: number) => Promise<string>
    containerId: (compose: string[]) => Promise<string>
    waitForHealthy: (id: string) => Promise<void>
    assertSecurityReady: (id: string) => Promise<void>
    passed: (label: string) => void
}>
