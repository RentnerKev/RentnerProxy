function normalizeHttpOrigin(value: string): string | null {
    try {
        const url = new URL(value)

        if (
            (url.protocol !== 'http:' && url.protocol !== 'https:') ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash ||
            !url.hostname
        ) {
            return null
        }

        return url.toString().replace(/\/$/u, '')
    } catch {
        return null
    }
}

export function parseTrustedManagementOrigin(configured: string | undefined): string | null {
    if (configured === undefined) return null
    const origin = normalizeHttpOrigin(configured.trim())
    if (!origin) return null

    const url = new URL(origin)
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
        ? origin
        : null
}
