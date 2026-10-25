import { MAIL_LOGO_PATH, MAIL_LOGO_VERSION } from '@/config/mail.config.ts'
import { deriveAccentPalette } from '@/lib/Theme/accentPalette.ts'

export function createMailUrl(appUrl: string, path: string): URL {
    let configured: URL
    try {
        configured = new URL(appUrl)
    } catch {
        throw new Error('PUBLIC_ORIGIN is invalid.')
    }
    if (
        (configured.protocol !== 'http:' && configured.protocol !== 'https:') ||
        configured.username ||
        configured.password ||
        !configured.hostname
    ) {
        throw new Error('PUBLIC_ORIGIN is invalid.')
    }
    return new URL(path, configured.origin)
}

export function createMailLogoUrl(appUrl: string, accentColor: string): string {
    const accent = deriveAccentPalette(accentColor).accent.slice(1)
    const url = createMailUrl(appUrl, `${MAIL_LOGO_PATH}${accent}`)
    url.searchParams.set('v', MAIL_LOGO_VERSION)
    return url.toString()
}
