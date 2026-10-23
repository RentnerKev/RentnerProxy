import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createBeta2Receivers } from '../../../../../.github/scripts/ci/beta2/receivers.ts'

const providerHeaders = {
    authorization: 'Bearer beta2-fixture-provider-token',
    'content-type': 'application/json',
}
const zone = 'a'.repeat(32)
const initial = 'b'.repeat(32)

// All requests are local fixture traffic; no real Docker daemon or provider is contacted.
describe('Beta-2 native receiver fixtures', () => {
    test('serves discovery and strictly scoped provider requests, preserving operator record metadata', async () => {
        const fixture = createBeta2Receivers()
        try {
            expect(await (await fetch(fixture.ipv4Url)).text()).toBe('ip=8.8.4.4\n')
            fixture.setAddress('1.1.1.1')
            expect(await (await fetch(fixture.ipv4Url)).text()).toBe('ip=1.1.1.1\n')
            expect(await (await fetch(fixture.ipv6Url)).text()).toBe('ip=2606:4700:4700::1111\n')
            const zones = await (
                await fetch(fixture.providerUrl + 'zones?page=1&per_page=20', {
                    headers: providerHeaders,
                })
            ).json()
            expect(zones).toMatchObject({
                success: true,
                result: [{ id: zone, name: 'beta2.test' }],
                result_info: { per_page: 20, total_pages: 1 },
            })
            const base = fixture.providerUrl + `zones/${zone}/dns_records`
            const read = () =>
                fetch(base + '?name=app.beta2.test&page=1&per_page=100', {
                    headers: providerHeaders,
                })
            const before = await (await read()).json()
            const changed = await (
                await fetch(base + '/' + initial, {
                    method: 'PATCH',
                    headers: providerHeaders,
                    body: JSON.stringify({ content: '1.1.1.1', proxied: false }),
                })
            ).json()
            // Snapshot the actual wire response, including metadata the DDNS PATCH must preserve.
            expect(changed).toMatchInlineSnapshot(`
              {
                "errors": [],
                "messages": [],
                "result": {
                  "comment": "Preserve Beta-2 operator metadata",
                  "content": "1.1.1.1",
                  "id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  "name": "app.beta2.test",
                  "proxied": false,
                  "tags": [
                    "fixture:beta2",
                  ],
                  "ttl": 300,
                  "type": "A",
                },
                "success": true,
              }
            `)
            expect(changed.result).toEqual({ ...before.result[0], content: '1.1.1.1' })
            expect((await (await read()).json()).result).toEqual([changed.result])
            const created = await (
                await fetch(base, {
                    method: 'POST',
                    headers: providerHeaders,
                    body: JSON.stringify({
                        name: 'created.beta2.test',
                        type: 'AAAA',
                        content: '2606:4700:4700::1111',
                        proxied: false,
                        ttl: 1,
                        comment: 'synthetic-marker',
                    }),
                })
            ).json()
            expect(created).toMatchObject({
                success: true,
                result: {
                    name: 'created.beta2.test',
                    type: 'AAAA',
                    ttl: 1,
                    comment: 'synthetic-marker',
                },
            })
            expect(fixture.counters).toMatchObject({
                ipv4Reads: 2,
                ipv6Reads: 1,
                providerReads: 3,
                providerWrites: 2,
                unexpectedRequests: 0,
            })
            fixture.setProviderUnavailable(true)
            expect((await read()).status).toBe(503)
            fixture.setProviderUnavailable(false)
            expect((await read()).status).toBe(200)
            expect((await fetch(fixture.ipv4Url, { headers: providerHeaders })).status).toBe(400)
            expect(
                (
                    await fetch(base + '/' + initial, {
                        method: 'PATCH',
                        headers: providerHeaders,
                        body: JSON.stringify({
                            content: '1.0.0.1',
                            proxied: false,
                            comment: 'overwrite forbidden',
                        }),
                    })
                ).status,
            ).toBe(400)
            expect(fixture.counters.deniedMutations).toBe(1)
            expect(() => fixture.setAddress('not-an-address')).toThrow()
        } finally {
            await fixture.stop()
        }
    })

    test('recreates a stable-source Docker candidate and exposes both real upstreams without allowing mutations', async () => {
        const fixture = createBeta2Receivers()
        try {
            expect(
                await (
                    await fetch(`http://${fixture.dockerAddress}:${fixture.primaryPort}`)
                ).json(),
            ).toEqual({ backend: 'a' })
            expect(
                await (
                    await fetch(`http://${fixture.dockerAddress}:${fixture.secondaryPort}`)
                ).json(),
            ).toEqual({ backend: 'b' })
            expect(await (await fetch(fixture.url + '/version')).json()).toMatchObject({
                ApiVersion: '1.47',
            })
            const listUrl =
                fixture.url +
                '/v1.47/containers/json?all=1&filters=' +
                encodeURIComponent('{"label":["rentnerproxy.enable=true"]}')
            const before = await (await fetch(listUrl)).json()
            expect(before[0].Id).toBe('a'.repeat(64))
            const inspect = await (
                await fetch(fixture.url + `/v1.47/containers/${before[0].Id}/json`)
            ).json()
            expect(inspect.Config.Labels).toMatchObject({
                'rentnerproxy.id': 'beta2-fixture-app',
                'rentnerproxy.port': String(fixture.primaryPort),
            })
            expect(inspect.NetworkSettings.Networks['beta2-fixture'].IPAddress).toBe(
                fixture.dockerAddress,
            )
            fixture.recreateContainer()
            const after = await (await fetch(listUrl)).json()
            expect(after[0].Id).toBe('c'.repeat(64))
            expect(after[0].Labels['rentnerproxy.id']).toBe(before[0].Labels['rentnerproxy.id'])
            expect(after[0].Labels['rentnerproxy.port']).toBe(String(fixture.secondaryPort))
            expect(
                (await fetch(fixture.url + `/v1.47/containers/${before[0].Id}/json`)).status,
            ).toBe(404)
            expect(
                (
                    await fetch(fixture.url + `/v1.47/containers/${after[0].Id}/stop`, {
                        method: 'POST',
                    })
                ).status,
            ).toBe(400)
            expect(fixture.counters.deniedMutations).toBe(1)
            fixture.setDockerUnavailable(true)
            expect((await fetch(listUrl)).status).toBe(503)
            fixture.setDockerUnavailable(false)
            expect((await fetch(listUrl)).status).toBe(200)
        } finally {
            await fixture.stop()
        }
    })

    test('streams only requested Docker events, rotates every recreation and closes active subscriptions', async () => {
        const fixture = createBeta2Receivers()
        const filter =
            '{"type":["container","network"],"event":["create","start","stop","die","destroy","rename","update","pause","unpause","connect","disconnect"]}'
        try {
            const response = await fetch(
                fixture.url + '/v1.47/events?since=1&filters=' + encodeURIComponent(filter),
            )
            expect(response.status).toBe(200)
            const reader = response.body!.getReader()
            expect(new TextDecoder().decode((await reader.read()).value)).toBe('\n')
            fixture.recreateContainer()
            const first = new TextDecoder()
                .decode((await reader.read()).value)
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line))
            expect(first.map((event) => event.Action)).toEqual(['destroy', 'create', 'start'])
            expect(first[0].Actor.ID).toBe('a'.repeat(64))
            expect(first[1].Actor.ID).toBe('c'.repeat(64))
            fixture.recreateContainer()
            const second = new TextDecoder()
                .decode((await reader.read()).value)
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line))
            expect(second[0].Actor.ID).toBe('c'.repeat(64))
            expect(second[1].Actor.ID).not.toBe(first[1].Actor.ID)
            const current = await (
                await fetch(fixture.url + `/v1.47/containers/${second[1].Actor.ID}/json`)
            ).json()
            expect(current.Config.Labels['rentnerproxy.port']).toBe(String(fixture.primaryPort))
            fixture.setDockerUnavailable(true)
            expect((await reader.read()).done).toBe(true)
            expect(fixture.counters.unexpectedRequests).toBe(0)
            fixture.setDockerUnavailable(false)
            const finalResponse = await fetch(
                fixture.url + '/v1.47/events?since=1&filters=' + encodeURIComponent(filter),
            )
            const finalReader = finalResponse.body!.getReader()
            await finalReader.read()
            // Forced fixture shutdown may finish the HTTP stream or reset its underlying socket.
            const terminal = finalReader.read().then(
                (result) => result.done,
                (error: unknown) =>
                    error instanceof Error && 'code' in error && error.code === 'ECONNRESET',
            )
            await fixture.stop()
            expect(await terminal).toBe(true)
        } finally {
            await fixture.stop()
        }
    })

    test.skipIf(!Bun.which('openssl'))(
        'accepts production STARTTLS mail with a trusted fixture certificate and rejects other recipients',
        async () => {
            const directory = await mkdtemp(join(tmpdir(), 'beta2-smtp-fixture-'))
            try {
                const cert = join(directory, 'fixture-cert.pem')
                const key = join(directory, 'fixture-key.pem')
                const generate = Bun.spawn(
                    [
                        Bun.which('openssl')!,
                        'req',
                        '-x509',
                        '-newkey',
                        'rsa:2048',
                        '-nodes',
                        '-days',
                        '1',
                        '-subj',
                        '/CN=127.0.0.1',
                        '-addext',
                        'subjectAltName=IP:127.0.0.1',
                        '-addext',
                        'basicConstraints=critical,CA:TRUE',
                        '-keyout',
                        key,
                        '-out',
                        cert,
                    ],
                    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
                )
                await new Response(generate.stderr).text()
                expect(await generate.exited).toBe(0)
                expect(await readFile(cert, 'utf8')).toContain('BEGIN CERTIFICATE')
                const script = `
                import {readFile} from 'node:fs/promises';
                import {createBeta2Receivers} from ${JSON.stringify(resolve('.github/scripts/ci/beta2/receivers.ts'))};
                import {createNotificationMailClient} from ${JSON.stringify(resolve('web/src/server/Mail/mail.service.ts'))};
                const f=createBeta2Receivers({smtpTls:{cert:await readFile(${JSON.stringify(cert)},'utf8'),key:await readFile(${JSON.stringify(key)},'utf8')}});
                const configuration={host:'127.0.0.1',port:f.smtpPort,secure:false,user:null,password:null,from:'fixture@beta2.invalid'};
                let mail=createNotificationMailClient(configuration);
                try {
                    await mail.sendMail({from:'fixture@beta2.invalid',to:'fixture@beta2.invalid',subject:'Synthetic fixture',text:'Safe local message'});
                    if(f.counters.smtpMessages!==1) throw new Error('SMTP counter did not advance');
                    mail.close();
                    mail=createNotificationMailClient(configuration);
                    await mail.sendMail({from:'fixture@beta2.invalid',to:['fixture@beta2.invalid'],subject:'Synthetic recovery',text:'Second independent trusted TLS connection'});
                    if(f.counters.smtpMessages!==2) throw new Error('Second SMTP connection did not deliver');
                    mail.close();
                    mail=createNotificationMailClient(configuration);
                    let rejected=false;
                    try {await mail.sendMail({from:'fixture@beta2.invalid',to:'other@beta2.invalid',subject:'Denied fixture',text:'Must reject recipient'});} catch {rejected=true;}
                    if(!rejected||f.counters.smtpMessages!==2||f.counters.deniedMutations!==1) throw new Error('SMTP recipient gate failed');
                    console.log('trusted STARTTLS fixture passed');
                } finally {mail.close();await f.stop();}
            `
                const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], {
                    cwd: process.cwd(),
                    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
                    stdin: 'ignore',
                    stdout: 'pipe',
                    stderr: 'pipe',
                })
                const [output, errors, exit] = await Promise.all([
                    new Response(child.stdout).text(),
                    new Response(child.stderr).text(),
                    child.exited,
                ])
                expect(exit, errors).toBe(0)
                expect(output).toContain('trusted STARTTLS fixture passed')
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        },
        30_000,
    )

    test('validates webhook authorization, safe payload and request identity, including receiver outages', async () => {
        const fixture = createBeta2Receivers()
        try {
            const id = crypto.randomUUID()
            const headers = {
                authorization: 'Bearer beta2-fixture-webhook-token',
                'content-type': 'application/json',
                'idempotency-key': id,
                'x-rentnerproxy-event-id': id,
            }
            const payload = {
                schemaVersion: 1,
                id,
                incidentId: crypto.randomUUID(),
                type: 'test',
                category: 'ddns',
                severity: 'info',
                resourceId: 'synthetic-ddns',
                code: 'notification_test',
                occurredAt: new Date().toISOString(),
                startedAt: new Date().toISOString(),
                failures: 0,
            }
            const send = () =>
                fetch(fixture.url + '/webhook', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(payload),
                })
            expect((await send()).status).toBe(204)
            fixture.setWebhookUnavailable(true)
            expect((await send()).status).toBe(503)
            fixture.setWebhookUnavailable(false)
            expect((await send()).status).toBe(204)
            expect(
                (
                    await fetch(fixture.url + '/webhook', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ ...payload, secret: 'synthetic forbidden field' }),
                    })
                ).status,
            ).toBe(400)
            expect(
                (
                    await fetch(fixture.url + '/webhook', {
                        method: 'POST',
                        headers: { ...headers, authorization: 'Bearer wrong-fixture-token' },
                        body: JSON.stringify(payload),
                    })
                ).status,
            ).toBe(400)
            expect(fixture.counters).toMatchObject({
                webhooks: 3,
                smtpMessages: 0,
                unexpectedRequests: 2,
                deniedMutations: 2,
            })
        } finally {
            await fixture.stop()
        }
    })
})
