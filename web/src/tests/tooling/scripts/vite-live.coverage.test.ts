import { afterAll, expect, mock, spyOn, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { UserConfig, ViteDevServer } from 'vite'
import type { createLiveWebSocketRuntime } from '../../../../../web/src/server/WebSockets/realtimeWebSocket.ts'

const runtimes: Parameters<typeof createLiveWebSocketRuntime>[0][] = []
const shutdown = mock(async () => undefined)
const handle = mock(async (..._arguments: unknown[]) => ({
    handled: true,
    response: new Response('upgraded'),
}))
mock.module('../../../../../web/src/server/WebSockets/realtimeWebSocket.ts', () => ({
    createLiveWebSocketRuntime(options: Parameters<typeof createLiveWebSocketRuntime>[0]) {
        runtimes.push(options)
        return { websocket: {}, shutdown, handle }
    },
}))
const { createLiveVitePlugin } = await import('../../../../../scripts/development/vite-live.ts')
const stop = mock(() => undefined)
const serve = spyOn(Bun, 'serve').mockImplementation(
    () => ({ port: 12345, stop }) as unknown as ReturnType<typeof Bun.serve>,
)
const fetcher = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(async () => new Response('snapshot'), { preconnect: () => undefined }),
)
const originalOrigin = process.env.PUBLIC_ORIGIN
const originalAlias = process.env.RENTNERPROXY_PUBLIC_ORIGIN
delete process.env.PUBLIC_ORIGIN
delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
afterAll(() => {
    serve.mockRestore()
    fetcher.mockRestore()
    if (originalOrigin === undefined) delete process.env.PUBLIC_ORIGIN
    else process.env.PUBLIC_ORIGIN = originalOrigin
    if (originalAlias === undefined) delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
    else process.env.RENTNERPROXY_PUBLIC_ORIGIN = originalAlias
})

async function configure(config: UserConfig = {}) {
    const plugin = createLiveVitePlugin()
    if (typeof plugin.config !== 'function') throw new Error('Expected config hook.')
    const result = await plugin.config.call({} as never, config, {
        command: 'serve',
        mode: 'development',
    })
    const runtime = runtimes.at(-1)!
    const allowedOrigin = runtime.allowedOrigin
    if (typeof allowedOrigin !== 'function') throw new Error('Expected dynamic origin.')
    return {
        plugin,
        result,
        origin: () => allowedOrigin(new Request('http://localhost/api/live')),
        readSnapshot: (request: Request) =>
            runtime.readSnapshot(request, { request, topic: 'foundation', query: {} }),
    }
}

test('development proxy forwards only the live socket and carries current origin, cookies and query to snapshot reads', async () => {
    const { plugin, result, origin, readSnapshot } = await configure({
        server: { host: '0.0.0.0', port: 4321 },
    })
    expect(await origin()).toBe('http://localhost:4321')
    const proxy = result?.server?.proxy?.['/api/live']
    if (!proxy || typeof proxy === 'string') throw new Error('Expected live proxy.')
    expect(proxy.target).toBe('ws://127.0.0.1:12345')
    expect(proxy.ws).toBe(true)
    expect(proxy.changeOrigin).toBe(false)
    const bypass = proxy.bypass!
    expect(await bypass({ url: '/api/live?cursor=1' } as never, {} as never, proxy)).toBeUndefined()
    expect(await bypass({ url: '/api/lively' } as never, {} as never, proxy)).toBe('/api/lively')
    const controller = new AbortController()
    const response = await readSnapshot(
        new Request('http://localhost/api/live?cursor=17', {
            headers: {
                cookie: 'session=synthetic',
                origin: 'http://localhost:4321',
                authorization: 'must-not-forward',
            },
            signal: controller.signal,
        }),
    )
    expect(await response.text()).toBe('snapshot')
    const forwarded = fetcher.mock.calls.at(-1)?.[0]
    expect(forwarded).toBeInstanceOf(Request)
    const request = forwarded as Request
    expect(request.url).toBe('http://localhost:4321/api/live-snapshot?cursor=17')
    expect(request.method).toBe('GET')
    expect(request.headers.get('cookie')).toBe('session=synthetic')
    expect(request.headers.get('origin')).toBe('http://localhost:4321')
    expect(request.headers.has('authorization')).toBe(false)
    controller.abort()
    expect(request.signal.aborted).toBe(true)
    const events = new EventEmitter()
    if (typeof plugin.configureServer !== 'function') throw new Error('Expected server hook.')
    const server = { httpServer: events, resolvedUrls: null } as unknown as ViteDevServer
    plugin.configureServer.call({} as never, server)
    server.resolvedUrls = { local: ['http://127.0.0.1:6789/path'], network: [] }
    events.emit('listening')
    expect(await origin()).toBe('http://127.0.0.1:6789')
    const fetchOptions = serve.mock.calls.at(-1)?.[0]
    if (!fetchOptions || !('fetch' in fetchOptions) || typeof fetchOptions.fetch !== 'function')
        throw new Error('Expected sidecar fetch.')
    const sidecar = async (path: string) => {
        const sidecarResponse = await fetchOptions.fetch!.call(
            {} as never,
            new Request('http://localhost' + path),
            {} as never,
        )
        if (!sidecarResponse) throw new Error('Expected sidecar response.')
        return sidecarResponse
    }
    expect(await (await sidecar('/api/live')).text()).toBe('upgraded')
    handle.mockResolvedValueOnce({ handled: false, response: new Response() })
    expect((await sidecar('/unrelated')).status).toBe(404)
    const previousStops = stop.mock.calls.length
    events.emit('close')
    if (typeof plugin.closeBundle !== 'function') throw new Error('Expected cleanup hook.')
    plugin.closeBundle.call({} as never)
    expect(stop.mock.calls.length).toBe(previousStops + 1)
    expect(shutdown).toHaveBeenCalled()
    expect((await sidecar('/api/live')).status).toBe(404)
})

test('build mode opens no sidecar and configured public origin remains authoritative after Vite starts', async () => {
    const build = createLiveVitePlugin()
    if (typeof build.config !== 'function') throw new Error('Expected config hook.')
    const previous = serve.mock.calls.length
    expect(
        await build.config.call({} as never, {}, { command: 'build', mode: 'production' }),
    ).toBeUndefined()
    expect(serve.mock.calls.length).toBe(previous)
    process.env.PUBLIC_ORIGIN = 'https://proxy.example.test'
    const { plugin, origin } = await configure({ server: { host: 'dev.example.test' } })
    expect(await origin()).toBe('https://proxy.example.test')
    if (typeof plugin.configureServer !== 'function') throw new Error('Expected server hook.')
    const events = new EventEmitter()
    plugin.configureServer.call(
        {} as never,
        {
            httpServer: events,
            resolvedUrls: { local: ['http://localhost:5173'], network: [] },
        } as unknown as ViteDevServer,
    )
    expect(await origin()).toBe('https://proxy.example.test')
    events.emit('close')
    delete process.env.PUBLIC_ORIGIN
})
