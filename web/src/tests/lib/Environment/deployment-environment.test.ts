import { describe, expect, spyOn, test } from 'bun:test'

import { readDeploymentEnvironmentVariable } from '@/lib/Environment/deployment-environment.ts'

describe('deployment environment aliases', () => {
    test.each(['PUBLIC_ORIGIN', 'PROXY_TRUSTED_PROXY_CIDRS'] as const)(
        '%s preserves explicit new values and warns once about the legacy name without logging values',
        (variable) => {
            const legacyVariable = `RENTNERPROXY_${variable}`
            const warning = spyOn(console, 'warn').mockImplementation(() => undefined)
            try {
                expect(readDeploymentEnvironmentVariable(variable, {})).toBeUndefined()
                expect(
                    readDeploymentEnvironmentVariable(variable, { [variable]: 'new-value' }),
                ).toBe('new-value')
                expect(
                    readDeploymentEnvironmentVariable(variable, {
                        [variable]: 'new-value',
                        [legacyVariable]: null,
                    }),
                ).toBe('new-value')
                expect(
                    readDeploymentEnvironmentVariable(variable, { [legacyVariable]: null }),
                ).toBeUndefined()
                expect(warning).not.toHaveBeenCalled()

                expect(
                    readDeploymentEnvironmentVariable(variable, {
                        [legacyVariable]: '',
                    }),
                ).toBe('')
                expect(warning).toHaveBeenCalledTimes(1)
                const message = String(warning.mock.calls[0]?.[0])
                expect(message).toContain(`${legacyVariable} is deprecated`)
                expect(message).toContain(`Please rename it to ${variable}`)
                expect(message).not.toContain('private-legacy-value')
                expect(
                    readDeploymentEnvironmentVariable(variable, {
                        [legacyVariable]: 'private-legacy-value',
                    }),
                ).toBe('private-legacy-value')

                for (const value of ['new-value', '', 'invalid']) {
                    expect(
                        readDeploymentEnvironmentVariable(variable, {
                            [variable]: value,
                            [legacyVariable]: 'private-legacy-value',
                        }),
                    ).toBe(value)
                }
                expect(warning).toHaveBeenCalledTimes(1)
            } finally {
                warning.mockRestore()
            }
        },
    )
})
