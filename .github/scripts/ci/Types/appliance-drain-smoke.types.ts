export type DrainCommandOptions = {
    stdin?: string
    timeoutMs?: number
    allowFailure?: boolean
}

export type DrainCommandResult = { code: number; output: string }

export type DrainCommand = (
    args: string[],
    options?: DrainCommandOptions,
) => Promise<DrainCommandResult>

export type DrainFixture = {
    command: DrainCommand
    container: string
    upstream: string
    domain: string
    root: string
    step?: (name: string) => void
}

export type DrainResponse = {
    ok: boolean
    status?: number
    error?: string
    elapsedMs: number
}

export type DrainLifecycleEvent = {
    action: string
    signal?: string
    exitCode?: string
}
