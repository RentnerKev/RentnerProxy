import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import {
    getCertificateJobOperationStage,
    isCertificateJobFailure,
    isCertificateJobRetryable,
    publishCertificateJobProgress,
    upsertCertificateJobProgress,
} from '../features/Admin/ProxyHostManagement/CertificateJobs/certificateJobProgress'
import { certificateJobProgressQueryKeys } from '../features/Admin/ProxyHostManagement/CertificateJobs/queryKeys'
import type { CertificateJobSummary } from '../shared/Types/certificate-jobs.types'

function job(overrides: Partial<CertificateJobSummary> = {}): CertificateJobSummary {
    return {
        id: '0198f2f0-0000-7000-8000-000000000081',
        proxyHostId: '0198f2f0-0000-7000-8000-000000000082',
        certificateId: '0198f2f0-0000-7000-8000-000000000083',
        domains: ['app.example.com'],
        stage: 'preparing',
        controllerStage: null,
        lastErrorCode: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
    }
}

describe('certificate job background progress', () => {
    test('maps every durable job stage and preserves detailed controller stages', () => {
        expect(getCertificateJobOperationStage(job({ stage: 'preparing' }))).toBe('queued')
        expect(getCertificateJobOperationStage(job({ stage: 'issuing' }))).toBe('creating_order')
        expect(
            getCertificateJobOperationStage(
                job({ stage: 'issuing', controllerStage: 'preparing_challenge' }),
            ),
        ).toBe('preparing_challenge')
        expect(
            getCertificateJobOperationStage(
                job({ stage: 'issuing', controllerStage: 'waiting_for_validation' }),
            ),
        ).toBe('waiting_for_validation')
        expect(getCertificateJobOperationStage(job({ stage: 'applying' }))).toBe('applying')
        expect(getCertificateJobOperationStage(job({ stage: 'applied' }))).toBe('applied')
        expect(getCertificateJobOperationStage(job({ stage: 'failed' }))).toBe('failed')
        expect(getCertificateJobOperationStage(job({ stage: 'needs_attention' }))).toBe(
            'needs_attention',
        )
    })

    test('keeps persisted failures visible and only offers retry with retained job material', () => {
        const activeFailure = job({
            stage: 'issuing',
            controllerStage: 'retry_scheduled',
            lastErrorCode: 'controller_unavailable',
        })
        expect(isCertificateJobFailure(activeFailure)).toBeTrue()
        expect(isCertificateJobRetryable(activeFailure)).toBeTrue()
        expect(isCertificateJobRetryable({ ...activeFailure, certificateId: null })).toBeFalse()
        expect(isCertificateJobRetryable({ ...activeFailure, proxyHostId: null })).toBeFalse()
    })

    test('updates one stable job surface without overwriting parallel requests', () => {
        const first = job()
        const second = job({
            id: '0198f2f0-0000-7000-8000-000000000084',
            domains: ['second.example.com'],
        })
        const applied = { ...first, stage: 'applied' as const, controllerStage: 'applied' as const }

        expect(upsertCertificateJobProgress([first, second], applied)).toEqual([applied, second])
        expect(upsertCertificateJobProgress([first], second)).toEqual([first, second])
    })

    test('keeps a newly published job when an older in-flight query resolves later', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        })
        let resolveStaleQuery: ((jobs: CertificateJobSummary[]) => void) | undefined
        const staleQuery = new Promise<CertificateJobSummary[]>((resolve) => {
            resolveStaleQuery = resolve
        })
        const inFlight = queryClient
            .fetchQuery({
                queryKey: certificateJobProgressQueryKeys.all,
                queryFn: () => staleQuery,
            })
            .catch(() => undefined)
        await Promise.resolve()

        const queued = job()
        await publishCertificateJobProgress(queryClient, queued)
        resolveStaleQuery?.([])
        await inFlight

        expect(
            queryClient.getQueryData<CertificateJobSummary[]>(certificateJobProgressQueryKeys.all),
        ).toEqual([queued])
        queryClient.clear()
    })
})
