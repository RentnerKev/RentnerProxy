export type CiGetJson = (path: string, signal: AbortSignal) => Promise<unknown>

export interface ReleaseCiRun {
    readonly id: number
    readonly number: number
    readonly attempt: number
    readonly workflowId: number
    readonly path: string
    readonly repository: string
    readonly headRepository: string | null
    readonly sha: string
    readonly branch: string | null
    readonly event: string
    readonly status: string
    readonly conclusion: string | null
}

export interface ReleaseCiJob {
    readonly id: number
    readonly runId: number
    readonly sha: string
    readonly name: string
    readonly status: string
    readonly conclusion: string | null
}
