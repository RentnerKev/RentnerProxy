const buildFailureCategories = [
    ['registry-rate-limit', /too\s*many\s*requests|pull rate limit|\b429\b/iu],
    ['disk-space', /no space left on device|\bENOSPC\b/iu],
    ['memory', /out of memory|cannot allocate memory|exit code:?\s*137\b/iu],
    ['source-import', /could not resolve|cannot find module|\bTS(?:2307|6053)\b/iu],
    ['typescript', /error TS\d{4}\b/iu],
    ['tls', /certificate verify failed|failed to verify certificate|x509:.*unknown authority/iu],
    ['base-image', /failed to resolve source metadata|failed to fetch (?:anonymous|oauth) token/iu],
    [
        'dependency-download',
        /failed to (?:fetch|download)|connection timed out|temporary failure resolving|unable to fetch/iu,
    ],
] as const

export function dockerBuildDiagnostic(output: string): string {
    const category =
        buildFailureCategories.find(([, pattern]) => pattern.test(output))?.[0] ?? 'unknown'
    return 'Docker build diagnostic: ' + category
}

export function isDockerBuildDiagnostic(message: string): boolean {
    return (
        message === 'Docker build diagnostic: unknown' ||
        buildFailureCategories.some(
            ([category]) => message === 'Docker build diagnostic: ' + category,
        )
    )
}
