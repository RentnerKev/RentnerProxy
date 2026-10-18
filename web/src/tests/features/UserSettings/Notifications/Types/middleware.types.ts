export interface PersonalNotificationRouteFixture {
    readonly method: 'GET' | 'POST'
    readonly validate: ((input: unknown) => unknown) | null
    readonly handle: (context: { data: unknown }) => Promise<unknown>
}
