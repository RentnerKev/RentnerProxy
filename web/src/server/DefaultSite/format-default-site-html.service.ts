import '@tanstack/react-start/server-only'
import { format } from 'oxfmt'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { defaultSiteHtmlSchema } from '@/lib/DefaultSite/defaultSite.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { DefaultSiteHtmlFormatError } from './default-site.errors.ts'

export async function formatDefaultSiteHtmlService(input: unknown): Promise<string> {
    await requirePermissionService(PERMISSIONS.DEFAULT_SITE_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const html = defaultSiteHtmlSchema.parse(input)
    const result = await format('default-site.html', html, {
        tabWidth: 4,
        printWidth: 100,
        htmlWhitespaceSensitivity: 'strict',
    })
    // Parser diagnostics can include the private draft. Return only a generic error.
    if (result.errors.length) throw new DefaultSiteHtmlFormatError()
    return defaultSiteHtmlSchema.parse(result.code)
}
