export type GitHubRequest = (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
) => Promise<unknown>

export interface MaintenanceResult {
    number: number
    action: 'update-requested' | 'merged' | 'skipped' | 'failed' | 'would-update' | 'would-merge'
    reason: string
}

export interface MaintenanceOptions {
    repository: string
    dryRun: boolean
    trustedMergeBotLogin?: string
}
