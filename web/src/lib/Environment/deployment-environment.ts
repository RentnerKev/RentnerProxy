const warnedLegacyVariables = new Set<string>()

export function readDeploymentEnvironmentVariable(
    variable: 'PUBLIC_ORIGIN' | 'PROXY_TRUSTED_PROXY_CIDRS',
    environment: Readonly<Record<string, string | null | undefined>> = process.env,
): string | undefined {
    const legacyVariable = `RENTNERPROXY_${variable}`
    const legacyValue = environment[legacyVariable]

    if (typeof legacyValue === 'string' && !warnedLegacyVariables.has(legacyVariable)) {
        warnedLegacyVariables.add(legacyVariable)
        console.warn(
            `[config] ${legacyVariable} is deprecated. Please rename it to ${variable}; ${variable} takes precedence when both are set.`,
        )
    }

    return environment[variable] ?? legacyValue ?? undefined
}
