import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { createBeta2AutomationFixture } from '../../../../../.github/scripts/ci/fixtures/beta2-automation-state.ts'

test.each(['', 'null'])(
    'Beta 2 seed handles absent PostgreSQL settings returned as %j',
    async (aggregateOutput) => {
        const fixture = createBeta2AutomationFixture('beta2-empty-settings')
        let reads = 0
        let writes = 0
        try {
            await fixture.seedDatabase(
                async (args) => {
                    if (args.some((arg) => arg.includes("lookup('host.docker.internal'")))
                        return JSON.stringify([{ address: '127.0.0.1', family: 4 }])
                    if (args.some((arg) => arg.includes('json_object_agg'))) {
                        reads += 1
                        return aggregateOutput
                    }
                    if (args.some((arg) => arg.includes('INSERT INTO rentnerproxy.proxy_hosts')))
                        writes += 1
                    return ''
                },
                'synthetic-container',
                Bun.randomUUIDv7(),
                Buffer.alloc(32, 17).toString('base64'),
            )
            expect(reads).toBe(1)
            expect(writes).toBe(1)
            expect(fixture.counters()).toEqual({ dockerRequests: 0, deliveries: [] })
        } finally {
            fixture.stop()
        }
    },
)

test('Beta 2 Docker receiver accepts the production versioned inventory/events contract and rejects drift', async () => {
    const client = await readFile(
        new URL('../../../../../core/src/runtime/docker_discovery/client.rs', import.meta.url),
        'utf8',
    )
    const api = /const API: &str = "([^"]+)"/u.exec(client)?.[1]
    const inventoryFilter = /const FILTER: &str = r#"(.*?)"#/u.exec(client)?.[1]
    const eventFilter = /\("filters", r#"(.*?)"#\.into\(\)\),/u.exec(client)?.[1]
    expect(api).toBe('/v1.47')
    expect(inventoryFilter).toBeDefined()
    expect(eventFilter).toBeDefined()
    const fixture = createBeta2AutomationFixture('beta2-docker-wire')
    const base = `http://127.0.0.1:${fixture.receiverPort}`
    const headers = { accept: 'application/json' }
    try {
        const inventory = await fetch(
            base +
                api +
                '/containers/json?' +
                new URLSearchParams({ all: '1', filters: inventoryFilter! }),
            { headers },
        )
        expect(inventory.status).toBe(200)
        const rows = (await inventory.json()) as { Id: string; Labels: Record<string, string> }[]
        expect(rows).toHaveLength(1)
        expect(rows[0]!.Labels['rentnerproxy.enable']).toBe('true')
        const inspected = await fetch(base + api + '/containers/' + rows[0]!.Id + '/json', {
            headers,
        })
        expect(inspected.status).toBe(200)
        expect(((await inspected.json()) as { Id: string }).Id).toBe(rows[0]!.Id)
        const eventQuery = new URLSearchParams({
            since: String(Math.floor(Date.now() / 1_000)),
            filters: eventFilter!,
        })
        const events = await fetch(base + api + '/events?' + eventQuery, {
            headers,
            signal: AbortSignal.timeout(2_000),
        })
        expect(events.status).toBe(200)
        const reader = events.body!.getReader()
        expect(new TextDecoder().decode((await reader.read()).value)).toBe('\n')
        await reader.cancel()
        await Promise.all(
            [
                '/containers/json',
                '/events',
                api + '/containers/json?all=0&filters=' + encodeURIComponent(inventoryFilter!),
                api + '/containers/json?all=1&filters=%7B%7D',
                api + '/events?since=yesterday&filters=' + encodeURIComponent(eventFilter!),
                api +
                    '/events?since=' +
                    Date.now() +
                    '&filters=' +
                    encodeURIComponent(eventFilter!),
            ].map(async (path) => {
                expect((await fetch(base + path, { headers })).status).not.toBe(200)
            }),
        )
        expect(
            (
                await fetch(base + '/notifications', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ id: 'wire-notification' }),
                })
            ).status,
        ).toBe(204)
        expect(fixture.counters().deliveries).toEqual(['wire-notification'])
    } finally {
        fixture.stop()
    }
})
