import type { createCertificateSmokeContext } from '../context.ts'
import type { verifyCertificateSetup } from '../setup.ts'
import type { verifyCertificateTrustedProxy } from '../trusted-proxy.ts'
import type { verifyCertificateTlsProtocols } from '../tls-protocols.ts'
import type { verifyCertificateManualLifecycle } from '../manual-lifecycle.ts'
import type { verifyCertificateHttpAcme } from '../http-acme.ts'
import type { verifyCertificateActivationRecovery } from '../activation-recovery.ts'
import type { verifyCertificateDnsAcme } from '../dns-acme.ts'
import type { verifyCertificateAccessPolicies } from '../access-policies.ts'
import type { verifyCertificateIpPolicies } from '../ip-policies.ts'

export type CertificateSetupContext = Awaited<ReturnType<typeof createCertificateSmokeContext>>
export type CertificateTrustedProxyContext = CertificateSetupContext &
    Awaited<ReturnType<typeof verifyCertificateSetup>>
export type CertificateTlsProtocolsContext = CertificateTrustedProxyContext &
    Awaited<ReturnType<typeof verifyCertificateTrustedProxy>>
export type CertificateManualLifecycleContext = CertificateTlsProtocolsContext &
    Awaited<ReturnType<typeof verifyCertificateTlsProtocols>>
export type CertificateHttpAcmeContext = CertificateManualLifecycleContext &
    Awaited<ReturnType<typeof verifyCertificateManualLifecycle>>
export type CertificateActivationRecoveryContext = CertificateHttpAcmeContext &
    Awaited<ReturnType<typeof verifyCertificateHttpAcme>>
export type CertificateDnsAcmeContext = CertificateActivationRecoveryContext &
    Awaited<ReturnType<typeof verifyCertificateActivationRecovery>>
export type CertificateAccessPoliciesContext = CertificateDnsAcmeContext &
    Awaited<ReturnType<typeof verifyCertificateDnsAcme>>
export type CertificateIpPoliciesContext = CertificateAccessPoliciesContext &
    Awaited<ReturnType<typeof verifyCertificateAccessPolicies>>
export type CertificateLogsAndJobsContext = CertificateIpPoliciesContext &
    Awaited<ReturnType<typeof verifyCertificateIpPolicies>>
