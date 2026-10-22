import '@tanstack/react-start/server-only'

import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { getProxyRuntimeStatus } from '@/server/Controller/proxy.server.ts'
import { createProxyLiveRevisionReader } from './proxy-live-revision.ts'
import { proxyLiveDigestQuery } from './proxy-live-revision.sql.ts'

export const getProxyLiveRevisionService = createProxyLiveRevisionReader({
    authorize: requirePermissionService,
    readRuntime: getProxyRuntimeStatus,
    readDigest: async (topic) => {
        const rows = await getAuthDatabase().execute<{ digest: string }>(
            proxyLiveDigestQuery(topic),
        )
        if (rows.length !== 1 || !rows[0]) throw new Error('Invalid live database result')
        return rows[0].digest
    },
})
