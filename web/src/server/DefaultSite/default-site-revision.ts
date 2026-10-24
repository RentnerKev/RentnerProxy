// oxlint-disable-next-line import/no-unassigned-import -- Settings hashing stays on the server boundary.
import '@tanstack/react-start/server-only'

import { createHash } from 'node:crypto'

import { defaultSiteSettingsSchema } from '@/lib/DefaultSite/defaultSite.ts'
import type { DefaultSiteSettings } from '@/lib/DefaultSite/Types/default-site.types.ts'

export function createDefaultSiteRevision(settings: DefaultSiteSettings): string {
    const canonical = defaultSiteSettingsSchema.parse(settings)
    return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`
}
