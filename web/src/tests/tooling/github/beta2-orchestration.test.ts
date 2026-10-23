import { describe, expect, test } from 'bun:test'
import {
    beta2Directory,
    validateBeta2Environment,
} from '../../../../../.github/scripts/ci/beta2/run.ts'

const environment = {
    RENTNERPROXY_BETA2_INTEGRATION: '1',
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/rentnerproxy_beta2_test',
    VALKEY_URL: 'redis://127.0.0.1:6379',
}

describe('Beta 2 launcher mutation boundaries', () => {
    test('accepts only explicitly enabled Linux loopback fixtures', () => {
        expect(() => validateBeta2Environment(environment, 'linux')).not.toThrow()
        expect(() => validateBeta2Environment(environment, 'win32')).toThrow()
        expect(() =>
            validateBeta2Environment(
                { ...environment, RENTNERPROXY_BETA2_INTEGRATION: undefined },
                'linux',
            ),
        ).toThrow()
        expect(() =>
            validateBeta2Environment(
                { ...environment, RENTNERPROXY_BETA2_INTEGRATION: 'run-id' },
                'linux',
            ),
        ).toThrow()
    })
    test('rejects unrelated databases, remote endpoints and connection overrides', () => {
        for (const DATABASE_URL of [
            'postgresql://127.0.0.1/production',
            'postgresql://example.test/rentnerproxy_beta2_test',
            'postgresql://127.0.0.1/rentnerproxy_beta2_test?host=example.test',
            'https://127.0.0.1/rentnerproxy_beta2_test',
        ])
            expect(() =>
                validateBeta2Environment({ ...environment, DATABASE_URL }, 'linux'),
            ).toThrow()
        for (const VALKEY_URL of [
            'redis://example.test:6379',
            'redis://127.0.0.1:6379?host=example.test',
            'https://127.0.0.1',
        ])
            expect(() =>
                validateBeta2Environment({ ...environment, VALKEY_URL }, 'linux'),
            ).toThrow()
    })
    test('temporary deletion targets have one exact parent and an unforgeable run-ID shape', () => {
        expect(beta2Directory('a'.repeat(32))).toBe('/tmp/rentnerproxy-beta2-' + 'a'.repeat(32))
        for (const runId of [
            '',
            '../other',
            'a'.repeat(31),
            'a'.repeat(33),
            'A'.repeat(32),
            'a'.repeat(31) + '/',
        ])
            expect(() => beta2Directory(runId)).toThrow()
    })
})
