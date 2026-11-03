import { expect, mock, test } from 'bun:test'
const events: string[] = []
const result = new Response('streamed', { status: 201 })
let blocked = false
const raw = mock(async (_request: Request, _options?: unknown) => {
    events.push('stream')
    return result
})
const startWatcher = mock(() => {})
const stream = Symbol('default-stream')
const createHandler = mock((_stream: unknown) => raw)
const createEntry = mock((entry: unknown) => entry)
mock.module('@tanstack/react-start/server', () => ({
    createStartHandler: createHandler,
    defaultStreamHandler: stream,
}))
mock.module('@tanstack/react-start/server-entry', () => ({ createServerEntry: createEntry }))
mock.module('@/server/request-abort.server.ts', () => ({
    withRequestAbortHandling:
        (fetch: typeof raw) => async (request: Request, options?: unknown) => {
            events.push('abort')
            const rewritten = new Request(request)
            rewritten.headers.set('x-abort-wrapper', 'yes')
            return fetch(rewritten, options)
        },
}))
mock.module('@/server/Backups/restore-maintenance.server.ts', () => ({
    startRestoreMaintenanceWatcher: startWatcher,
    withRestoreMaintenanceFence: async (_request: Request, next: () => Promise<Response>) => {
        events.push('fence')
        return blocked ? new Response('maintenance', { status: 503 }) : next()
    },
}))
const { default: server } = await import('@/server.ts')

test('server adapter starts watcher and runs maintenance fencing before abort rewriting and streamed request context', async () => {
    expect(startWatcher).toHaveBeenCalledTimes(1)
    expect(createHandler).toHaveBeenCalledWith(stream)
    expect(createEntry).toHaveBeenCalledWith({ fetch: raw })
    const request = new Request('https://fixture.example/resource', {
        method: 'POST',
        body: 'fixture-body',
    })
    expect(await server.fetch(request)).toBe(result)
    expect(events).toEqual(['fence', 'abort', 'stream'])
    const rewritten = raw.mock.calls.at(-1)?.[0]
    expect(rewritten?.headers.get('x-abort-wrapper')).toBe('yes')
    expect(rewritten?.method).toBe('POST')
    expect(await rewritten?.text()).toBe('fixture-body')
    blocked = true
    events.length = 0
    const maintenance = await server.fetch(new Request('https://fixture.example/resource'))
    expect(maintenance.status).toBe(503)
    expect(events).toEqual(['fence'])
    expect(raw).toHaveBeenCalledTimes(1)
    blocked = false
    const failure = new Error('stream failure')
    raw.mockRejectedValueOnce(failure)
    await expect(server.fetch(new Request('https://fixture.example/failure'))).rejects.toBe(failure)
})
