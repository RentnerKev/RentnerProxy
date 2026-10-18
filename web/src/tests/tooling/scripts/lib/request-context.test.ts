import { expect, test } from 'bun:test'
import { withFixtureRequest } from '../../../../../../scripts/lib/request-context.ts'

const createHandler = ({ fetch }: { fetch: () => Promise<Response> }) => ({ fetch })

test('runs inside the authenticated request handler and preserves the operation result', async () => {
    const observed: { cookie: string | null } = { cookie: null }
    let insideRequest = false
    const result = await withFixtureRequest(
        ({ fetch }) => ({
            fetch: async (request) => {
                observed.cookie = request.headers.get('cookie')
                insideRequest = true
                try {
                    return await fetch()
                } finally {
                    insideRequest = false
                }
            },
        }),
        'session',
        'fixture-token',
        async () => {
            expect(insideRequest).toBe(true)
            return { id: 42 }
        },
    )
    expect(observed.cookie).toBe('session=fixture-token')
    expect(result).toEqual({ id: 42 })
})

test('preserves operation errors including undefined', async () => {
    const failure = new Error('fixture operation failed')
    await expect(
        withFixtureRequest(createHandler, 'session', 'token', async () => {
            throw failure
        }),
    ).rejects.toBe(failure)
    let caught = false
    try {
        await withFixtureRequest(createHandler, 'session', 'token', async () => {
            throw undefined
        })
    } catch (error) {
        caught = true
        expect(error).toBeUndefined()
    }
    expect(caught).toBe(true)
})

test('rejects when the request handler does not execute the operation', async () => {
    await expect(
        withFixtureRequest(
            () => ({ fetch: async () => new Response(null, { status: 401 }) }),
            'session',
            'token',
            async () => 'must not run',
        ),
    ).rejects.toThrow('fixture_request_unavailable')
})
