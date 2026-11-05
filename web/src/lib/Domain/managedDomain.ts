export function getManagedDomainHref(
    domain: string,
    scheme: 'http' | 'https' = 'https',
): string | null {
    const normalizedDomain = domain.toLowerCase()
    if (!normalizedDomain || normalizedDomain.includes('*')) return null

    try {
        const url = new URL(`${scheme}://${normalizedDomain}`)
        if (
            url.hostname !== normalizedDomain ||
            url.username ||
            url.password ||
            url.port ||
            url.pathname !== '/' ||
            url.search ||
            url.hash
        ) {
            return null
        }
        return `${scheme}://${normalizedDomain}`
    } catch {
        return null
    }
}
