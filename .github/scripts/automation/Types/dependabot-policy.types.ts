export interface DependabotEligibilityInput {
    pullRequest: unknown
    commits: readonly unknown[]
    files: readonly unknown[]
    repository: string
    trustedMergeBotLogin?: string
}

export interface DependabotEligibility {
    eligible: boolean
    reason: string
}
