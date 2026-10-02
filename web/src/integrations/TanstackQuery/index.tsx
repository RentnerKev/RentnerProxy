import { QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'

import useQueryClient from './Hooks/useQueryClient.ts'

export default function QueryProvider({ children }: PropsWithChildren) {
    const queryClient = useQueryClient()

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
