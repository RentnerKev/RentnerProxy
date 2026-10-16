export interface ServerFunctionResolver {
    readonly getServerFnById: (
        id: string,
        access: { readonly origin: 'client' | 'server' },
    ) => Promise<{ readonly method?: 'GET' | 'POST' }>
}
