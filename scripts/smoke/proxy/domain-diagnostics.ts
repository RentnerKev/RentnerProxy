import assert from 'node:assert/strict'
import { domainDiagnosticsResultSchema } from '../../../web/src/lib/RuntimeDiagnostics/domainDiagnostics.ts'
import type { DomainDiagnosticsSmokeOptions } from './Types/domain-diagnostics.types.ts'

export async function runDomainDiagnosticsSmoke({
    controller,
    snapshot,
    host,
    upstreamCode,
    tlsCode,
    checkBoundary = false,
}: DomainDiagnosticsSmokeOptions): Promise<void> {
    const path = '/internal/v1/diagnostics/domain'
    const input = {
        hostType: 'proxy',
        hostId: host.id,
        domain: host.domains[0],
        expectedRevision: snapshot.revision,
    }
    const readStatus = async () => {
        const response = await controller('/internal/v1/proxy/status')
        assert.equal(response.status, 200)
        return JSON.stringify(await response.json())
    }
    const before = await readStatus()
    const inspect = (body: unknown) =>
        controller(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })
    const response = await inspect(input)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') ?? '', /no-store/u)
    const raw: unknown = await response.json()
    const result = domainDiagnosticsResultSchema.parse(raw)
    assert.equal(result.hostId, host.id)
    assert.equal(result.domain, input.domain)
    assert.equal(result.activeRevision, snapshot.revision)
    assert.equal(result.expectedRevision, snapshot.revision)
    assert.equal(result.observationPoint, 'appliance')
    assert.equal(result.publicReachability, 'not_checked')
    assert.equal(result.stages.configuration.code, 'configuration_active')
    assert.equal(result.stages.upstream.code, upstreamCode)
    assert.equal(result.stages.tls.code, tlsCode)
    const serialized = JSON.stringify(raw)
    for (const privateValue of [
        'backend-http-ok',
        'backend-one',
        'PRIVATE KEY',
        'BEGIN CERTIFICATE',
    ])
        assert.ok(
            !serialized.includes(privateValue),
            'diagnostics must omit upstream bodies and TLS material',
        )

    const scheduledResponse = await inspect({ ...input, upstreamOnly: true, timeoutMs: 2_000 })
    assert.equal(scheduledResponse.status, 200)
    const scheduledRaw: unknown = await scheduledResponse.json()
    const scheduled = domainDiagnosticsResultSchema.parse(scheduledRaw)
    assert.equal(scheduled.stages.configuration.code, 'configuration_active')
    assert.equal(scheduled.stages.dns.code, 'skipped')
    assert.deepEqual(scheduled.stages.dns.addresses, [])
    assert.equal(scheduled.stages.upstream.code, upstreamCode)
    assert.equal(scheduled.stages.tls.code, tlsCode)
    assert.equal(scheduled.publicReachability, 'not_checked')

    if (checkBoundary) {
        const invalidTimeout = await inspect({ ...input, upstreamOnly: true, timeoutMs: 10_001 })
        assert.equal(invalidTimeout.status, 422)
        const stale = await inspect({ ...input, expectedRevision: 'sha256:' + '0'.repeat(64) })
        assert.equal(stale.status, 200)
        const staleResult = domainDiagnosticsResultSchema.parse(await stale.json())
        assert.equal(staleResult.stages.configuration.code, 'configuration_stale')
        assert.equal(staleResult.stages.upstream.code, 'skipped')
        assert.equal(staleResult.stages.tls.code, 'skipped')
        assert.equal(staleResult.stages.dns.code, 'skipped')
        const arbitraryTarget = await inspect({ ...input, forwardHost: '169.254.169.254' })
        assert.equal(arbitraryTarget.status, 422)
        const arbitraryDomain = await inspect({ ...input, domain: 'not-owned-by-host.example.net' })
        assert.equal(arbitraryDomain.status, 200)
        const arbitraryResult = domainDiagnosticsResultSchema.parse(await arbitraryDomain.json())
        assert.equal(arbitraryResult.stages.configuration.code, 'host_not_active')
        assert.equal(arbitraryResult.stages.dns.code, 'skipped')
        assert.equal(arbitraryResult.stages.upstream.code, 'skipped')
    }

    assert.equal(await readStatus(), before, 'diagnosis must not apply or reload configuration')
}
