import assert from 'node:assert/strict'
import { verifyProxyAccessLogs } from '../proxy/access-logs.ts'
import { verifyDurableCertificateJob } from './jobs.ts'
import type { CertificateLogsAndJobsContext } from './Types/scenarios.types.ts'

export async function verifyCertificateLogsAndJobs(context: CertificateLogsAndJobsContext) {
    assert.ok(context.backend)
    const loggingSnapshot = context.snapshot([{ ...context.policyHost, accessPolicy: undefined }])
    await context.apply(loggingSnapshot)
    await verifyProxyAccessLogs({
        controllerUrl: context.controllerUrl,
        httpUrl: context.httpUrl,
        runtimeContainer: context.runtimeContainer,
        controllerRequest: context.controllerRequest,
        command: context.command,
        waitFor: context.waitFor,
        restart: async () => {
            await context.restartRuntime()
            await context.waitFor(async () => {
                const response = await context.controllerRequest('/internal/v1/proxy/status')
                if (!response.ok) return false
                const status = context.jsonObject(await response.json())
                return status.running === true && status.activeRevision === loggingSnapshot.revision
            }, 'access log restart recovery')
        },
    })
    context.passed(
        'request logs preserve privacy, filters and pagination across restart and bounded rotation',
    )
    await verifyDurableCertificateJob({
        controllerUrl: context.controllerUrl,
        httpUrl: context.httpUrl,
        token: context.token,
        backendPort: context.backend.port!,
        temporaryDirectory: context.temp,
        waitFor: context.waitFor,
        restartRuntime: context.restartRuntime,
        verifyHttps: async () => {
            const response = await context.command([
                'curl',
                '--silent',
                '--show-error',
                '--head',
                '--cacert',
                context.temp + '/issuance-root.pem',
                '--resolve',
                'certificate-job.example.com:' + context.httpsPort + ':127.0.0.1',
                'https://certificate-job.example.com:' + context.httpsPort + '/job-ready',
            ])
            assert.match(response, /^HTTP\/(?:1\.1|2) 200(?:\s|$)/u)
        },
    })
    context.passed(
        'durable certificate jobs survive web and controller restart before verified HTTPS activation',
    )
    console.log('Certificate HTTPS/ACME integration: ' + context.assertions + ' checks passed.')
    return {}
}
