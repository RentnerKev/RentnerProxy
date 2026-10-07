export interface SmokeProcessOptions {
    readonly cwd: string
    readonly timeoutMs: number
    readonly env?: NodeJS.ProcessEnv
    readonly stdin?: string
    readonly inherit?: boolean
}

export interface SmokeProcessResult {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
    readonly timedOut: boolean
}
