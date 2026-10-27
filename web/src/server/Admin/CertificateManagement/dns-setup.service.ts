import '@tanstack/react-start/server-only'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { DNS_SETUP_CHECK_RATE_LIMIT } from '@/config/certificates.config.ts'
import {
    dnsSetupInputSchema,
    manualDnsCheckInputSchema,
} from '@/lib/Admin/CertificateManagement/dnsSetupValidation.ts'
import type {
    DnsSetupInput,
    DnsSetupResult,
    ManualDnsCheckInput,
    ManualDnsCheckResult,
} from '@/lib/Admin/CertificateManagement/Types/dns-setup.types.ts'
import type { ManualDnsChallengeMetadata } from '@/lib/Admin/CertificateManagement/Types/certificates.types.ts'
import { requireUserService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import { certificateDnsSetupController } from '@/server/Controller/dns-setup.server.ts'
import { getCertificateRow } from './certificate-metadata.persistence.ts'
import { CertificateDomainError } from './certificates.errors.ts'
import type { CertificateDnsSetupDependencies } from './Types/dns-setup.types.ts'

function matchesManualRecords(
    check: ManualDnsCheckResult,
    manual: ManualDnsChallengeMetadata,
): boolean {
    const expected = new Map<string, Set<string>>()
    for (const record of manual.records) {
        const identifiers = expected.get(record.owner) ?? new Set<string>()
        identifiers.add(record.identifier)
        expected.set(record.owner, identifiers)
    }
    return (
        check.expiresAt === manual.expiresAt &&
        check.records.length === expected.size &&
        check.records.every((record) => {
            const identifiers = expected.get(record.owner)
            return (
                identifiers?.size === record.identifiers.length &&
                record.identifiers.every((identifier) => identifiers.has(identifier))
            )
        })
    )
}

export function createCertificateDnsSetupService(dependencies: CertificateDnsSetupDependencies) {
    return {
        async inspectCertificateDnsSetupService(input: DnsSetupInput): Promise<DnsSetupResult> {
            const actor = await dependencies.currentUser()
            await dependencies.assertSetupAccess(actor.id)
            const parsed = dnsSetupInputSchema.safeParse(input)
            if (!parsed.success) throw new CertificateDomainError('invalid_input')
            await dependencies.limit(actor.id)
            const result = await dependencies.controller.setup(parsed.data)
            await dependencies.assertSetupAccess(actor.id)
            return result
        },
        async checkManualDnsService(input: ManualDnsCheckInput): Promise<ManualDnsCheckResult> {
            const actor = await dependencies.currentUser()
            if (
                !actor.permissions.includes(PERMISSIONS.CERTIFICATES_ISSUE) &&
                !actor.permissions.includes(PERMISSIONS.CERTIFICATES_RENEW)
            )
                throw new AuthDomainError('permission_denied', 'Permission is required.')
            const parsed = manualDnsCheckInputSchema.safeParse(input)
            if (!parsed.success) throw new CertificateDomainError('invalid_input')
            const before = await dependencies.assertManualAccess(actor.id, parsed.data)
            await dependencies.limit(actor.id)
            const result = await dependencies.controller.check(parsed.data)
            const after = await dependencies.assertManualAccess(actor.id, parsed.data)
            if (JSON.stringify(before) !== JSON.stringify(after))
                throw new CertificateDomainError('operation_in_progress')
            if (!matchesManualRecords(result, after))
                throw new CertificateDomainError('controller_unavailable')
            return result
        },
    }
}

export const { inspectCertificateDnsSetupService, checkManualDnsService } =
    createCertificateDnsSetupService({
        currentUser: requireUserService,
        assertSetupAccess: async (actorId) => {
            await getAuthDatabase().transaction(async (transaction) => {
                await requirePermissionInTransaction(
                    transaction,
                    actorId,
                    PERMISSIONS.CERTIFICATES_ISSUE,
                )
            })
        },
        assertManualAccess: (actorId, input) =>
            getAuthDatabase().transaction(async (transaction) => {
                const row = await getCertificateRow(transaction, input.certificateId, false)
                const operation = row.currentOperation
                await requirePermissionInTransaction(
                    transaction,
                    actorId,
                    operation?.kind === 'renew'
                        ? PERMISSIONS.CERTIFICATES_RENEW
                        : PERMISSIONS.CERTIFICATES_ISSUE,
                )
                if (
                    row.source !== 'acme' ||
                    !operation ||
                    !['issue', 'renew'].includes(operation.kind) ||
                    operation.dnsMode !== 'manual' ||
                    operation.id !== input.operationId ||
                    operation.manualDns?.challengeSetId !== input.challengeSetId ||
                    operation.manualDns.status !== 'awaiting_input'
                )
                    throw new CertificateDomainError('operation_in_progress')
                return operation.manualDns
            }),
        limit: async (actorId) => {
            await consumeRateLimit({ ...DNS_SETUP_CHECK_RATE_LIMIT, identifier: actorId })
        },
        controller: certificateDnsSetupController,
    })
