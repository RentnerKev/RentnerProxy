import { describe, expect, test } from 'bun:test'

import type {
    CertificateOperationKind,
    CertificateOperationStage,
} from '../config/certificates.config'
import {
    getCertificateOperationDisplay,
    getCertificateOperationSearchValues,
    hasActiveCertificateOperation,
} from '../features/Admin/CertificateManagement/Helpers/certificateOperations'
import type { CertificateSummary } from '../shared/Types/certificates.types'

const baseCertificate: CertificateSummary = {
    id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54021',
    name: 'Public edge',
    domains: ['app.example.com'],
    source: 'acme',
    environment: 'production',
    status: 'valid',
    operation: 'idle',
    currentOperation: null,
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-04-01T00:00:00Z'),
    issuer: 'Example CA',
    fingerprint: 'SHA256:fixture',
    candidate: null,
    dnsCleanupPending: false,
    lastErrorCode: null,
    assignedHostCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function withCurrentOperation(
    kind: CertificateOperationKind,
    stage: CertificateOperationStage,
): CertificateSummary {
    return {
        ...baseCertificate,
        currentOperation: {
            id: `operation-${kind}-${stage}`,
            kind,
            stage,
            startedAt: new Date('2026-02-01T09:00:00Z'),
            updatedAt: new Date('2026-02-01T09:15:00Z'),
        },
    }
}

describe('certificate operation presentation', () => {
    test('shows no operation for stable certificate material', () => {
        expect(getCertificateOperationDisplay(baseCertificate)).toEqual({
            id: null,
            kind: null,
            stage: null,
        })
        expect(hasActiveCertificateOperation(baseCertificate)).toBeFalse()
    })

    test('keeps every current non-completed stage visible and active', () => {
        const stages: readonly CertificateOperationStage[] = [
            'queued',
            'creating_order',
            'preparing_challenge',
            'waiting_for_validation',
            'finalizing',
            'certificate_ready',
            'applying',
            'retry_scheduled',
            'failed',
            'needs_attention',
        ]

        for (const stage of stages) {
            const certificate = withCurrentOperation('renew', stage)
            expect(getCertificateOperationDisplay(certificate)).toEqual({
                id: `operation-renew-${stage}`,
                kind: 'renew',
                stage,
            })
            expect(hasActiveCertificateOperation(certificate)).toBeTrue()
        }
    })

    test('uses the coarse issue and renewal state when detailed metadata is absent', () => {
        expect(
            getCertificateOperationDisplay({ ...baseCertificate, operation: 'issuing' }),
        ).toEqual({ id: null, kind: 'issue', stage: 'queued' })
        expect(
            getCertificateOperationDisplay({ ...baseCertificate, operation: 'renewing' }),
        ).toEqual({ id: null, kind: 'renew', stage: 'queued' })
    })

    test('treats completed issue, renewal, and import operations as history', () => {
        const kinds: readonly CertificateOperationKind[] = ['issue', 'renew', 'import']

        for (const kind of kinds) {
            const certificate = withCurrentOperation(kind, 'applied')
            expect(getCertificateOperationDisplay(certificate)).toEqual({
                id: null,
                kind: null,
                stage: null,
            })
            expect(getCertificateOperationSearchValues(certificate)).toEqual([])
            expect(hasActiveCertificateOperation(certificate)).toBeFalse()
        }
    })

    test('does not hide applied metadata until the coarse operation is idle', () => {
        const certificate = {
            ...withCurrentOperation('renew', 'applied'),
            operation: 'renewing' as const,
        }
        expect(getCertificateOperationDisplay(certificate).stage).toBe('applied')
        expect(hasActiveCertificateOperation(certificate)).toBeTrue()
    })

    test('falls through completed history to current retry and failure metadata', () => {
        const completed = withCurrentOperation('issue', 'applied')
        const retryScheduled: CertificateSummary = {
            ...completed,
            candidate: {
                fingerprint: 'sha256:' + 'b'.repeat(64),
                issuedAt: new Date('2026-02-01T00:00:00Z'),
                expiresAt: new Date('2027-02-01T00:00:00Z'),
                lastErrorCode: 'runtime_apply_failed',
                nextAttemptAt: new Date('2026-02-01T10:42:00Z'),
            },
        }
        expect(getCertificateOperationDisplay(retryScheduled).stage).toBe('retry_scheduled')

        const failed: CertificateSummary = {
            ...completed,
            lastErrorCode: 'acme_failed',
        }
        expect(getCertificateOperationDisplay(failed).stage).toBe('failed')
    })
})
