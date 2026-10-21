import '@tanstack/react-start/server-only'
import { hostListQuerySchema } from '@/features/Admin/HostTags/validation.ts'
import { filterHostPage } from '@/lib/HostTags/hostList.ts'
import { LANGUAGE_RESOURCE_LOADERS } from '@/lib/Language/resources.ts'
import { getProxyHostsService } from '@/server/Admin/ProxyHostManagement/proxy-hosts.service.ts'
import { getRedirectHostsService } from '@/server/Admin/RedirectHostManagement/redirect-hosts.service.ts'
import { getHostTagCatalogService } from './host-tags.service.ts'

export async function getProxyHostPageService(input: unknown) {
    const query = hostListQuerySchema.parse(input)
    // Host services enforce their view permission before any host or tag metadata is returned.
    const hosts = await getProxyHostsService()
    const catalog = await getHostTagCatalogService('proxy')
    const messages = await LANGUAGE_RESOURCE_LOADERS[query.locale]()
    return filterHostPage(hosts, catalog.tags, query, {
        enabled: messages.admin.proxyHosts.status.enabled,
        disabled: messages.admin.proxyHosts.status.disabled,
    })
}

export async function getRedirectHostPageService(input: unknown) {
    const query = hostListQuerySchema.parse(input)
    const hosts = await getRedirectHostsService()
    const catalog = await getHostTagCatalogService('redirect')
    const messages = await LANGUAGE_RESOURCE_LOADERS[query.locale]()
    return filterHostPage(hosts, catalog.tags, query, {
        enabled: messages.admin.redirectHosts.status.enabled,
        disabled: messages.admin.redirectHosts.status.disabled,
    })
}
