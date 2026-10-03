export interface JobSmokeOptions {
    readonly controllerUrl: string
    readonly httpUrl: string
    readonly token: string
    readonly backendPort: number
    readonly temporaryDirectory: string
    readonly waitFor: (probe: () => Promise<boolean>, label: string) => Promise<void>
    readonly restartRuntime: () => Promise<void>
    readonly verifyHttps: () => Promise<void>
}
