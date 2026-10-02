import { describe, expect, test } from 'bun:test'
import {
    certificateFailureDetails,
    pebbleFailureCategories,
} from '../../../../../scripts/runtime-reliability/diagnostics.ts'

describe('certificate failure evidence', () => {
    test('preserves known state and bounded operation transitions', () => {
        expect(
            certificateFailureDetails(
                {
                    status: 'failed',
                    operation: 'idle',
                    lastErrorCode: 'acme_failed',
                    currentOperation: { stage: 'retry_scheduled' },
                    candidate: null,
                    fingerprint: null,
                },
                ['queued', 'waiting_for_validation', 'retry_scheduled'],
            ),
        ).toEqual({
            status: 'failed',
            operation: 'idle',
            errorCode: 'acme_failed',
            stage: 'retry_scheduled',
            candidatePresent: false,
            fingerprintPresent: false,
            observedStages: ['queued', 'waiting_for_validation', 'retry_scheduled'],
        })
        const result = certificateFailureDetails(
            {
                status: 'valid',
                operation: 'idle',
                lastErrorCode: 'runtime_apply_failed',
                currentOperation: { stage: 'retry_scheduled' },
                candidate: {},
                fingerprint: 'sha256:' + 'a'.repeat(64),
            },
            Array.from({ length: 100 }, () => 'applying'),
        )
        expect(result.candidatePresent).toBe(true)
        expect(result.fingerprintPresent).toBe(true)
        expect(result.observedStages).toHaveLength(32)
    })
    test('unknown payloads, IDs, messages, material and stage strings never escape', () => {
        const secret = 'private-token-and-PEM'
        const result = certificateFailureDetails(
            {
                status: secret,
                operation: secret,
                lastErrorCode: secret,
                id: secret,
                currentOperation: { stage: secret, id: secret },
                candidate: { privateKey: secret },
                fingerprint: secret,
                message: secret,
            },
            [secret],
        )
        expect(JSON.stringify(result)).not.toContain(secret)
        expect(result.stage).toBe('unexpected')
        expect(result.fingerprintPresent).toBe(false)
        expect(certificateFailureDetails(null, []).status).toBe('unexpected')
    })
    test('only known ACME problem types escape private Pebble output', () => {
        const secret = 'https://private.example/token/credential'
        expect(
            pebbleFailureCategories(secret + ' urn:ietf:params:acme:error:unauthorized badNonce'),
        ).toEqual(['unauthorized'])
        expect(pebbleFailureCategories(secret + ' urn:ietf:params:acme:error:private')).toEqual([])
        expect(
            pebbleFailureCategories(
                'urn:ietf:params:acme:error:badNonce urn:ietf:params:acme:error:dns',
            ),
        ).toEqual(['dns', 'badNonce'])
    })
})
