import { expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

import {
    invalidateSecurityStatusCache,
    securityQueryKeys,
} from '@/lib/UserSettings/userSettingsCache.ts'

test('never reuses security metadata for a different signed-in identity', async () => {
    const client = new QueryClient()
    try {
        client.setQueryData(securityQueryKeys.status('old-user'), { passkeys: ['Private laptop'] })
        expect(client.getQueryData(securityQueryKeys.status('new-user'))).toBeUndefined()
        client.setQueryData(securityQueryKeys.status('new-user'), { passkeys: [] })
        await invalidateSecurityStatusCache(client)
        expect(client.getQueryState(securityQueryKeys.status('old-user'))?.isInvalidated).toBe(true)
        expect(client.getQueryState(securityQueryKeys.status('new-user'))?.isInvalidated).toBe(true)
    } finally {
        client.clear()
    }
})
