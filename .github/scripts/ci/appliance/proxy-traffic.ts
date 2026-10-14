import assert from 'node:assert/strict'
import { join } from 'node:path'
import { requestHttp3Client, assertHttp3Response } from '../../../../scripts/smoke/http3/client.ts'
import type { ApplianceProxyTrafficContext } from './Types/scenarios.types.ts'

export async function verifyApplianceProxyTraffic(context: ApplianceProxyTrafficContext) {
    const backendPort = await context.availableLoopbackPort()
    const trafficMarker = 'appliance-real-traffic-' + context.runId
    context.backend = Bun.serve({
        hostname: '0.0.0.0',
        port: backendPort,
        fetch: () => new Response(trafficMarker),
    })
    assert.ok(context.backend.port)
    const hostDomain = 'appliance-' + context.runId + '.test'
    const certificateId = '0198d98a-0000-7000-8000-' + context.runId
    const hostId = '0198d98a-0000-7000-8000-' + context.runId.slice(0, 11) + 'a'
    const certificateDirectory = '/tmp/rentnerproxy-appliance-certificate'
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sh',
        '-c',
        `set -Eeuo pipefail; rm -rf ${certificateDirectory}; mkdir -p ${certificateDirectory}; openssl req -x509 -newkey rsa:2048 -nodes -keyout ${certificateDirectory}/ca.key -out ${certificateDirectory}/ca.pem -days 1 -subj /CN=RentnerProxy-Appliance-CA; openssl req -new -newkey rsa:2048 -nodes -keyout ${certificateDirectory}/leaf.key -out ${certificateDirectory}/leaf.csr -subj /CN=${hostDomain}; printf 'subjectAltName=DNS:${hostDomain}\\nextendedKeyUsage=serverAuth\\nbasicConstraints=critical,CA:FALSE\\nkeyUsage=critical,digitalSignature,keyEncipherment\\n' > ${certificateDirectory}/leaf.ext; openssl x509 -req -in ${certificateDirectory}/leaf.csr -CA ${certificateDirectory}/ca.pem -CAkey ${certificateDirectory}/ca.key -CAcreateserial -out ${certificateDirectory}/leaf.pem -days 1 -sha256 -extfile ${certificateDirectory}/leaf.ext; chown -R 10001:10001 ${certificateDirectory}`,
    ])
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sh',
        '-c',
        `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="INSERT INTO rentnerproxy.certificates (id, name, source, status, operation) VALUES ('${certificateId}', 'Appliance smoke certificate', 'manual', 'pending', 'idle');" >/dev/null`,
    ])
    const importSource = `const token=await Bun.file('/run/rentnerproxy/controller-token/value').text();const certificatePem=await Bun.file('${certificateDirectory}/leaf.pem').text();const privateKeyPem=await Bun.file('${certificateDirectory}/leaf.key').text();const chainPem=await Bun.file('${certificateDirectory}/ca.pem').text();const response=await fetch('http://127.0.0.1:8081/internal/v1/certificates/${certificateId}/import',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({certificatePem,privateKeyPem,chainPem,requiredDomains:['${hostDomain}']})});process.stdout.write(String(response.status));if(response.status!==200)process.exit(1);`
    assert.equal(
        await context.command([
            'docker',
            'exec',
            '--user',
            '10001:10001',
            context.recreatedId,
            'bun',
            '-e',
            importSource,
        ]),
        '200',
    )
    const insertHostSql = `INSERT INTO rentnerproxy.proxy_hosts (id, forward_scheme, forward_host, forward_port, enabled, certificate_id, force_https, verify_upstream_tls) VALUES ('${hostId}', 'http', 'host.docker.internal', ${backendPort}, true, '${certificateId}', false, true); INSERT INTO rentnerproxy.host_domains (id, proxy_host_id, domain) VALUES ('0198d98a-0000-7000-8000-${context.runId.slice(0, 11)}b', '${hostId}', '${hostDomain}');`
    await context.command([
        'docker',
        'exec',
        context.recreatedId,
        'sh',
        '-c',
        `PGPASSWORD="$(cat /run/rentnerproxy/postgres/value)" gosu postgres psql --host=127.0.0.1 --username=rentnerproxy --dbname=rentnerproxy --command="${insertHostSql}" >/dev/null`,
    ])
    const realConfig = {
        version: 7,
        proxyHosts: [
            {
                id: hostId,
                domains: [hostDomain],
                forwardScheme: 'http',
                forwardHost: 'host.docker.internal',
                forwardPort: backendPort,
                certificateId,
            },
        ],
        redirectHosts: [],
        httpSettings: {},
        trustedCas: [],
    }
    const applyRealConfiguration = async (
        configuration: Record<string, unknown>,
        label: string,
    ): Promise<void> => {
        const request = {
            ...configuration,
            revision: 'sha256:' + context.digest(JSON.stringify(configuration)),
        }
        const response = await context.controllerCall(
            context.recreatedId,
            '/internal/v1/proxy/config',
            'PUT',
            request,
        )
        assert.equal(response.status, 200)
        await context.waitFor(async () => {
            const status = await context.controllerCall(
                context.recreatedId,
                '/internal/v1/proxy/status',
                'GET',
            )
            return status.status === 200 && status.body.includes(request.revision)
        }, label)
    }
    await applyRealConfiguration(realConfig, 'managed certificate configuration apply')
    const assertRealTraffic = async (container: string, label: string): Promise<void> => {
        const httpBody = await context.command([
            'docker',
            'exec',
            container,
            'curl',
            '--silent',
            '--show-error',
            '--noproxy',
            '*',
            '--header',
            'Host: ' + hostDomain,
            'http://127.0.0.1:8080/appliance-real-path',
        ])
        assert.equal(httpBody, trafficMarker)
        const httpsBody = await context.command([
            'docker',
            'exec',
            container,
            'curl',
            '--silent',
            '--show-error',
            '--noproxy',
            '*',
            '--insecure',
            '--resolve',
            hostDomain + ':8443:127.0.0.1',
            'https://' + hostDomain + ':8443/appliance-real-path',
        ])
        assert.equal(httpsBody, trafficMarker)
        context.passed(label)
    }
    await assertRealTraffic(
        context.recreatedId,
        'real HTTP and HTTPS managed-certificate traffic works',
    )
    const http3CaFile = join(context.temporaryRoot, 'http3-ca.pem')
    await context.command([
        'docker',
        'cp',
        context.recreatedId + ':' + certificateDirectory + '/ca.pem',
        http3CaFile,
    ])
    const assertPublishedQuic = async () => {
        const response = await requestHttp3Client(context.http3Command, {
            image: context.http3Image,
            caFile: http3CaFile,
            hostname: hostDomain,
            port: context.httpsPort,
            path: '/appliance-real-path',
        })
        assertHttp3Response(response, 200, context.httpsPort)
        assert.ok(response.output.includes(trafficMarker))
    }
    await assertPublishedQuic()
    context.passed(
        'production appliance serves verified HTTP/3 through published UDP with the public Alt-Svc port',
    )
    return {
        trafficMarker,
        hostDomain,
        realConfig,
        applyRealConfiguration,
        assertRealTraffic,
        http3CaFile,
        assertPublishedQuic,
    }
}
