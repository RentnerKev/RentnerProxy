import { extendSmokeContext } from '../context.ts'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { sharedSmokeImage } from '../images.ts'
import { createCertificateSmokeContext, repositoryRoot, isOwnedTempDirectory } from './context.ts'
import { verifyCertificateSetup } from './setup.ts'
import { verifyCertificateTrustedProxy } from './trusted-proxy.ts'
import { verifyCertificateTlsProtocols } from './tls-protocols.ts'
import { verifyCertificateManualLifecycle } from './manual-lifecycle.ts'
import { verifyCertificateHttpAcme } from './http-acme.ts'
import { verifyCertificateActivationRecovery } from './activation-recovery.ts'
import { verifyCertificateDnsAcme } from './dns-acme.ts'
import { verifyCertificateManualDns } from './manual-dns.ts'
import { manualDnsForwarderName } from './dns-forwarder.ts'
import { verifyCertificateAccessPolicies } from './access-policies.ts'
import { verifyCertificateIpPolicies } from './ip-policies.ts'
import { verifyCertificateLogsAndJobs } from './logs-and-jobs.ts'

async function runSmoke(): Promise<void> {
    const context = await createCertificateSmokeContext()
    try {
        const certificates = extendSmokeContext(context, await verifyCertificateSetup(context))
        const hosts = extendSmokeContext(
            certificates,
            await verifyCertificateTrustedProxy(certificates),
        )
        const protocols = extendSmokeContext(hosts, await verifyCertificateTlsProtocols(hosts))
        await verifyCertificateManualLifecycle(protocols)
        const acme = extendSmokeContext(protocols, await verifyCertificateHttpAcme(protocols))
        await verifyCertificateActivationRecovery(acme)
        const dns = extendSmokeContext(acme, await verifyCertificateDnsAcme(acme))
        await verifyCertificateManualDns(dns)
        const policies = extendSmokeContext(dns, await verifyCertificateAccessPolicies(dns))
        await verifyCertificateIpPolicies(policies)
        await verifyCertificateLogsAndJobs(policies)
    } finally {
        context.backend?.stop(true)
        context.dnsFixture?.stop()
        await context
            .command(['docker', 'rm', '--force', manualDnsForwarderName(context.project)])
            .catch(() => undefined)
        await context
            .command(['docker', 'rm', '--force', '--volumes', context.trustedProxyContainer])
            .catch(() => undefined)
        await context
            .command(['docker', 'rm', '--force', '--volumes', context.runtimeContainer])
            .catch(() => undefined)
        await context
            .command(['docker', 'rm', '--force', '--volumes', context.pebbleContainer])
            .catch(() => undefined)
        if (context.certSource)
            await context
                .command(['docker', 'rm', '--force', context.certSource])
                .catch(() => undefined)
        await context
            .command(['docker', 'volume', 'rm', context.stateVolume])
            .catch(() => undefined)
        await context.command(['docker', 'network', 'rm', context.network]).catch(() => undefined)
        if (!sharedSmokeImage('proxy-runtime'))
            await context
                .command(['docker', 'image', 'rm', context.runtimeImage])
                .catch(() => undefined)
        if (!sharedSmokeImage('http3-client'))
            await context
                .command(['docker', 'image', 'rm', context.http3Image])
                .catch(() => undefined)
        if (isOwnedTempDirectory(context.temp))
            await rm(context.temp, { recursive: true, force: true })
    }
}

if (import.meta.main && !existsSync(repositoryRoot + '/docker/proxy-runtime/Dockerfile')) {
    throw new Error('Run this smoke from the RentnerProxy repository.')
}
if (import.meta.main) await runSmoke()
