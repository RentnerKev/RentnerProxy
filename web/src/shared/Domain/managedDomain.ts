export function getManagedDomainHref(domain: string): string | null {
    const normalizedDomain = domain.toLowerCase()
    if (!normalizedDomain || normalizedDomain.includes('*')) return null

    try {
        const url = new URL(`https://${normalizedDomain}`)
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
        return `https://${normalizedDomain}`
    } catch {
        return null
    }
}
