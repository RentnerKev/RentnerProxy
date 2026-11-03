import { mock } from 'bun:test'
import type {
    BoundaryCall,
    BoundaryHandler,
    BoundaryValidator,
} from './Types/middleware-coverage.types.ts'

export function createMiddlewareHarness() {
    const calls: BoundaryCall[] = []
    const values = new Map<string, unknown>()
    const failures = new Map<string, unknown>()
    const headers = new Map<string, string>()
    const methods = new WeakMap<object, string>()
    let status = 200
    const service =
        (name: string) =>
        async (...arguments_: unknown[]) => {
            calls.push({ name, arguments: arguments_ })
            if (failures.has(name)) throw failures.get(name)
            return values.get(name)
        }
    const mockServices = (path: string, names: string[], exports: Record<string, unknown> = {}) => {
        mock.module(path, () => ({
            ...Object.fromEntries(names.map((name) => [name, service(name)])),
            ...exports,
        }))
    }
    mock.module('@tanstack/react-start', () => ({
        createServerOnlyFn: (handler: unknown) => handler,
        createServerFn: ({ method }: { method: string }) => {
            let validator: BoundaryValidator | undefined
            const builder = {
                validator: (value: BoundaryValidator) => {
                    validator = value
                    return builder
                },
                handler: (handler: BoundaryHandler) => {
                    const wrapped = async (input: { data?: unknown } = {}) => {
                        const data = validator
                            ? await (typeof validator === 'function'
                                  ? validator(input.data)
                                  : validator.parse(input.data))
                            : input.data
                        return handler({ data })
                    }
                    methods.set(wrapped, method)
                    return wrapped
                },
            }
            return builder
        },
    }))
    mock.module('@tanstack/react-start/server', () => ({
        setResponseHeader: (name: string, value: string) => headers.set(name, value),
        setResponseStatus: (value: number) => {
            status = value
        },
        getRequest: () => new Request('https://example.test'),
        getRequestIP: () => '127.0.0.1',
    }))
    mockServices(
        '@/server/Auth/Access/authorization.service.ts',
        ['requirePermissionService', 'requireSessionService', 'requireSessionPermission'],
        { isSessionRecentlyAuthenticated: () => true },
    )
    mock.module('@/server/Auth/transport.server.ts', () => ({
        enforceSensitiveLimit: service('enforceSensitiveLimit'),
        localizedActionFailure: (error: unknown, fallback: string) => {
            calls.push({ name: 'localizedActionFailure', arguments: [error, fallback] })
            return { success: false, message: fallback }
        },
        throwLocalizedQueryError: (error: unknown, fallback: string): never => {
            calls.push({ name: 'throwLocalizedQueryError', arguments: [error, fallback] })
            throw new Error(fallback)
        },
    }))
    return {
        calls,
        values,
        failures,
        headers,
        methods,
        mockServices,
        get status() {
            return status
        },
        reset() {
            calls.length = 0
            values.clear()
            failures.clear()
            headers.clear()
            status = 200
        },
        invoke: async (handler: unknown, data?: unknown) => (handler as BoundaryHandler)({ data }),
        argumentsFor: (name: string) =>
            calls.filter((call) => call.name === name).map((call) => call.arguments),
    }
}
