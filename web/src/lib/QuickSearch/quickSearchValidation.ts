import { z } from 'zod'
import {
    QUICK_SEARCH_MAX_QUERY_LENGTH,
    QUICK_SEARCH_MIN_QUERY_LENGTH,
} from '@/config/quick-search.config.ts'

export const quickSearchInputSchema = z.strictObject({
    query: z.string().trim().min(QUICK_SEARCH_MIN_QUERY_LENGTH).max(QUICK_SEARCH_MAX_QUERY_LENGTH),
    id: z.string().uuid().optional(),
})

export function getQuickSearchPattern(query: string): string {
    return `%${query.replace(/[\\%_]/g, '\\$&')}%`
}
