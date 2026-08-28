import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import type { PropsWithChildren } from 'react'

export default function QueryProvider({ children }: PropsWithChildren) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30_000,
                        gcTime: 10 * 60_000,
                        retry: 1,
                        refetchOnWindowFocus: false,
                    },
                    mutations: {
                        retry: 0,
                    },
                },
            }),
    )

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
