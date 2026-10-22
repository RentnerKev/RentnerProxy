import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { LANGUAGE_RESOURCE_LOADERS } from '@/lib/Language/resources.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { requirePermissionInTransaction } from '@/server/Auth/Access/rbac.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import { readProxyHostSummariesInTransaction } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { readRedirectHostSummariesInTransaction } from '@/server/Admin/RedirectHostManagement/redirect-hosts.service.ts'
import { readHostTags } from './host-tags.storage.server.ts'
import { readProxyHostListBasis, readRedirectHostListBasis } from './host-list.storage.server.ts'
import { createHostPageReader } from './host-page-reader.server.ts'

const snapshot = {
    authorize: requirePermissionService,
    reauthorize: requirePermissionInTransaction,
    transaction: <T>(run: (transaction: AuthTransaction) => Promise<T>) =>
        getAuthDatabase().transaction(run, {
            isolationLevel: 'repeatable read',
            accessMode: 'read only',
        }),
    readTags: readHostTags,
}

export const getProxyHostPageService = createHostPageReader({
    ...snapshot,
    kind: 'proxy',
    permission: PERMISSIONS.PROXY_HOSTS_VIEW,
    readBasis: readProxyHostListBasis,
    readSummaries: readProxyHostSummariesInTransaction,
    labels: async (locale) => (await LANGUAGE_RESOURCE_LOADERS[locale]()).admin.proxyHosts.status,
})

export const getRedirectHostPageService = createHostPageReader({
    ...snapshot,
    kind: 'redirect',
    permission: PERMISSIONS.REDIRECT_HOSTS_VIEW,
    readBasis: readRedirectHostListBasis,
    readSummaries: readRedirectHostSummariesInTransaction,
    labels: async (locale) =>
        (await LANGUAGE_RESOURCE_LOADERS[locale]()).admin.redirectHosts.status,
})
