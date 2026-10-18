export async function withFixtureRequest<T>(
    createHandler: (options: { fetch: () => Promise<Response> }) => {
        fetch: (request: Request, context: Record<string, never>) => unknown
    },
    cookieName: string,
    sessionToken: string,
    operation: () => Promise<T>,
): Promise<T> {
    let outcome: { value: T } | { error: unknown } | undefined
    const handler = createHandler({
        fetch: async () => {
            try {
                outcome = { value: await operation() }
            } catch (error) {
                outcome = { error }
            }
            return new Response(null, { status: 204 })
        },
    }).fetch
    await handler(
        new Request('http://localhost/', {
            headers: { cookie: cookieName + '=' + sessionToken },
        }),
        {},
    )
    if (!outcome) throw new Error('fixture_request_unavailable')
    if ('error' in outcome) throw outcome.error
    return outcome.value
}
