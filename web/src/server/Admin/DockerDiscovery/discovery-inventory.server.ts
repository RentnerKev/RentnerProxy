import '@tanstack/react-start/server-only'
import { asc, inArray } from 'drizzle-orm'
import {
    accessPolicies,
    certificates,
    certificateDomains,
    hostDomains,
    proxyHosts,
} from '@/db/schema.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import type { DockerDiscoverySnapshot } from '@/lib/DockerDiscovery/Types/docker-discovery.types.ts'
import type { DiscoveryInventory } from './Types/discovery-plan.types.ts'
import { toProxyHostSummary } from '@/server/Admin/ProxyHostManagement/proxy-hosts.mutations.server.ts'
import { certificateCoversDomains } from '@/lib/Admin/CertificateManagement/certificateValidation.ts'

/** Reads a deterministic, secret-free preview without mutating certificate metadata. */
export async function readDiscoveryInventory(
    transaction: AuthTransaction,
    snapshot: DockerDiscoverySnapshot | null,
): Promise<DiscoveryInventory> {
    const rows = await transaction.select().from(proxyHosts).orderBy(asc(proxyHosts.id))
    const domains = await transaction
        .select({ domain: hostDomains.domain, proxyHostId: hostDomains.proxyHostId })
        .from(hostDomains)
        .orderBy(asc(hostDomains.domain))
    const candidates = snapshot?.candidates ?? []
    const certificateIds = [
        ...new Set(
            candidates.flatMap((candidate) =>
                candidate.certificateId ? [candidate.certificateId] : [],
            ),
        ),
    ]
    const policyIds = [
        ...new Set(
            candidates.flatMap((candidate) =>
                candidate.accessPolicyId ? [candidate.accessPolicyId] : [],
            ),
        ),
    ]
    const certificateRows = certificateIds.length
        ? await transaction
              .select({
                  id: certificates.id,
                  status: certificates.status,
                  issuedAt: certificates.issuedAt,
                  expiresAt: certificates.expiresAt,
              })
              .from(certificates)
              .where(inArray(certificates.id, certificateIds))
        : []
    const certificateNames = certificateIds.length
        ? await transaction
              .select({ id: certificateDomains.certificateId, domain: certificateDomains.domain })
              .from(certificateDomains)
              .where(inArray(certificateDomains.certificateId, certificateIds))
        : []
    const policies = new Set(
        policyIds.length
            ? (
                  await transaction
                      .select({ id: accessPolicies.id })
                      .from(accessPolicies)
                      .where(inArray(accessPolicies.id, policyIds))
              ).map((policy) => policy.id)
            : [],
    )
    const domainsByHost = new Map<string, string[]>()
    for (const entry of domains) {
        if (entry.proxyHostId === null) continue
        const names = domainsByHost.get(entry.proxyHostId)
        if (names) names.push(entry.domain)
        else domainsByHost.set(entry.proxyHostId, [entry.domain])
    }
    const certificatesById = new Map(certificateRows.map((row) => [row.id, row]))
    const domainsByCertificate = new Map<string, string[]>()
    for (const entry of certificateNames) {
        const names = domainsByCertificate.get(entry.id)
        if (names) names.push(entry.domain)
        else domainsByCertificate.set(entry.id, [entry.domain])
    }
    const rejections: Record<string, 'reference_invalid'> = {}
    for (const candidate of candidates) {
        const certificate = candidate.certificateId
            ? certificatesById.get(candidate.certificateId)
            : undefined
        if (
            (candidate.accessPolicyId && !policies.has(candidate.accessPolicyId)) ||
            (candidate.certificateId &&
                (!certificate ||
                    certificate.status !== 'valid' ||
                    !certificate.issuedAt ||
                    !certificate.expiresAt ||
                    certificate.issuedAt.getTime() > Date.now() ||
                    certificate.expiresAt.getTime() <= Date.now() ||
                    !certificateCoversDomains(
                        domainsByCertificate.get(certificate.id) ?? [],
                        candidate.domains,
                    )))
        ) {
            rejections[candidate.containerId] = 'reference_invalid'
        }
    }
    return {
        hosts: rows.map((row) => toProxyHostSummary(row, domainsByHost.get(row.id) ?? [])),
        domains,
        rejections,
    }
}
