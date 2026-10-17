import type { UseQueryResult } from '@tanstack/react-query'

export type QueryRecoveryState = Pick<
    UseQueryResult,
    'isError' | 'isSuccess' | 'errorUpdatedAt' | 'refetch'
>
