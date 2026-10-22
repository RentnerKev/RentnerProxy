export type MaintenanceProcessOptions = Readonly<{
    cwd: string
    timeoutMs: number
    input?: Uint8Array
    env?: NodeJS.ProcessEnv
}>

export type MaintenanceProcessResult = Readonly<{
    exitCode: number | null
    failed: boolean
    timedOut: boolean
    stopped: boolean
    stdout: Uint8Array
    stderr: string
}>
