import { describe, expect, test } from 'bun:test'
import {
    dockerBuildDiagnostic,
    isDockerBuildDiagnostic,
} from '../../../../../scripts/docker-build-diagnostics.ts'

describe('Docker build diagnostics', () => {
    test.each([
        ['toomanyrequests: rate exceeded', 'registry-rate-limit'],
        ['write /private/fixture: no space left on device', 'disk-space'],
        ['process did not complete successfully: exit code: 137', 'memory'],
        ['Could not resolve "@/private/module"', 'source-import'],
        ['error TS6133: private fixture is unused', 'typescript'],
        ['x509: certificate signed by unknown authority', 'tls'],
        ['failed to resolve source metadata for private.invalid', 'base-image'],
        ['Temporary failure resolving private.invalid', 'dependency-download'],
        ['arbitrary private fixture output', 'unknown'],
    ])('classifies failure without returning private output: %s', (output, category) => {
        const message = dockerBuildDiagnostic(
            output + '\npassword=fixture-secret\n-----BEGIN PRIVATE KEY-----',
        )
        expect(message).toBe('Docker build diagnostic: ' + category)
        expect(isDockerBuildDiagnostic(message)).toBeTrue()
        expect(message).not.toContain('fixture-secret')
        expect(message).not.toContain('PRIVATE KEY')
    })

    test('rejects private or injected content appended to a valid category', () => {
        expect(isDockerBuildDiagnostic('Docker build diagnostic: disk-space secret')).toBeFalse()
        expect(isDockerBuildDiagnostic('Docker build diagnostic: unknown\nprivate')).toBeFalse()
    })

    test('does not mistake a source line or progress counter for a registry rate limit', () => {
        expect(dockerBuildDiagnostic('module.ts(429,1): error TS2307: Cannot find module')).toBe(
            'Docker build diagnostic: source-import',
        )
        expect(dockerBuildDiagnostic('Build stopped after 429 seconds')).toBe(
            'Docker build diagnostic: unknown',
        )
    })
})
