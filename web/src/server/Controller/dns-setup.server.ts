import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { CERTIFICATE_ERROR_CODES } from '@/config/certificates.config.ts'
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
import { isDnsZoneIdForProvider } from '@/lib/DnsConnections/validation.ts'
import { CertificateDomainError } from '@/server/Admin/CertificateManagement/certificates.errors.ts'
import { controllerRequest } from './transport.server.ts'
import { dnsSetupResultSchema, manualDnsCheckResultSchema } from './dns-setup.validation.ts'

const errorSchema = z.object({ error: z.enum(CERTIFICATE_ERROR_CODES) })

function decode<T>(payload: unknown, schema: z.ZodType<T>): T {
    const error = errorSchema.safeParse(payload)
    if (error.success) throw new CertificateDomainError(error.data.error)
    const result = schema.safeParse(payload)
    if (!result.success) throw new CertificateDomainError('controller_unavailable')
    return result.data
}

function sameIdentifiers(actual: readonly string[], expected: readonly string[]): boolean {
    return JSON.stringify(actual.toSorted()) === JSON.stringify(expected.toSorted())
}

function matchesSetup(input: DnsSetupInput, result: DnsSetupResult): boolean {
    if (
        result.connectionId !== input.connectionId ||
        result.connectionRevision !== input.expectedRevision ||
        result.zoneId !== input.zoneId ||
        result.dnsMode !== input.dnsMode ||
        !isDnsZoneIdForProvider(result.zoneId, result.provider)
    )
        return false
    if (
        new Set(result.results.map((item) => item.originalOwner)).size !== result.results.length ||
        !sameIdentifiers(
            result.results.flatMap((item) => item.identifiers),
            input.domains,
        )
    )
        return false
    return result.results.every((item) => {
        if (input.dnsMode === 'provider')
            return (
                item.instruction.type === 'TXT' &&
                item.instruction.values.length === 0 &&
                item.status === 'ready' &&
                item.identifiers.every((identifier) => {
                    const bare = identifier.replace(/^\*\./u, '')
                    return bare === result.zoneName || bare.endsWith(`.${result.zoneName}`)
                })
            )
        if (input.delegation?.type === 'cname')
            return (
                item.instruction.type === 'CNAME' &&
                item.instruction.values.length === 1 &&
                item.instruction.values[0] === `${input.delegation.targetOwner}.` &&
                (input.delegation.targetOwner === result.zoneName ||
                    input.delegation.targetOwner.endsWith(`.${result.zoneName}`)) &&
                (item.status !== 'ready' || item.observedTarget === input.delegation.targetOwner)
            )
        return (
            item.instruction.type === 'NS' &&
            (item.status !== 'ready' ||
                (item.originalOwner === result.zoneName &&
                    item.instruction.values.length > 0 &&
                    item.observedTarget === item.originalOwner))
        )
    })
}

export function createCertificateDnsSetupController(
    request: typeof controllerRequest = controllerRequest,
) {
    const options = {
        privileged: true,
        confidential: true,
        method: 'POST',
        timeoutMs: 20_000,
        responseLimit: 512 * 1_024,
        acceptErrorResponse: true,
    } as const
    return {
        async setup(input: DnsSetupInput): Promise<DnsSetupResult> {
            const parsed = dnsSetupInputSchema.safeParse(input)
            if (!parsed.success) throw new CertificateDomainError('invalid_input')
            const result = decode(
                await request('/internal/v1/certificates/dns-01/setup', {
                    ...options,
                    body: JSON.stringify(parsed.data),
                }),
                dnsSetupResultSchema,
            )
            if (!matchesSetup(parsed.data, result))
                throw new CertificateDomainError('controller_unavailable')
            return result
        },
        async check(input: ManualDnsCheckInput): Promise<ManualDnsCheckResult> {
            const parsed = manualDnsCheckInputSchema.safeParse(input)
            if (!parsed.success) throw new CertificateDomainError('invalid_input')
            const { certificateId, ...action } = parsed.data
            const result = decode(
                await request(`/internal/v1/certificates/${certificateId}/dns-01/check`, {
                    ...options,
                    body: JSON.stringify(action),
                }),
                manualDnsCheckResultSchema,
            )
            if (
                result.certificateId !== certificateId ||
                result.operationId !== action.operationId ||
                result.challengeSetId !== action.challengeSetId ||
                (result.status === 'ready' &&
                    result.records.some((item) => item.status !== 'ready'))
            )
                throw new CertificateDomainError('controller_unavailable')
            return result
        },
    }
}

export const certificateDnsSetupController = createCertificateDnsSetupController()
