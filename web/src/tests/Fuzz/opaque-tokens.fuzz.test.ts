import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'

import { AuthDomainError } from '../../server/Auth/Core/errors.server'
import { hashOpaqueToken, isValidOpaqueToken } from '../../server/Auth/Core/tokens.server'

const FUZZ_RUNS = 100
const opaqueTokenArbitrary = fc.stringMatching(/^[A-Za-z0-9_-]{43}$/)

describe('opaque token property fuzzing', () => {
    test('validates, hashes, and rejects mutations of arbitrary tokens', async () => {
        await fc.assert(
            fc.asyncProperty(
                opaqueTokenArbitrary,
                fc.integer({ min: 0, max: 42 }),
                async (token, mutationIndex) => {
                    expect(isValidOpaqueToken(token)).toBeTrue()

                    const [firstHash, repeatedHash] = await Promise.all([
                        hashOpaqueToken(token),
                        hashOpaqueToken(token),
                    ])
                    const invalidToken =
                        token.slice(0, mutationIndex) + '.' + token.slice(mutationIndex + 1)
                    let invalidTokenError: unknown

                    try {
                        await hashOpaqueToken(invalidToken)
                    } catch (error) {
                        invalidTokenError = error
                    }

                    expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
                    expect(firstHash).toBe(repeatedHash)
                    expect(isValidOpaqueToken(invalidToken)).toBeFalse()
                    expect(isValidOpaqueToken(token.slice(1))).toBeFalse()
                    expect(invalidTokenError).toBeInstanceOf(AuthDomainError)

                    if (invalidTokenError instanceof AuthDomainError) {
                        expect(invalidTokenError.code).toBe('invalid_input')
                    }
                },
            ),
            { numRuns: FUZZ_RUNS },
        )
    })
})
