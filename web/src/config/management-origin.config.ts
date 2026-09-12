export const PUBLIC_ORIGIN_ENVIRONMENT_VARIABLE = 'RENTNERPROXY_PUBLIC_ORIGIN'
export const DEFAULT_PUBLIC_ORIGIN = 'http://localhost:5173'

export type ManagementOriginEnvironment = 'development' | 'production'

function normalizeHttpOrigin(value: string): string | null {
    try {
        const url = new URL(value)

        if (
            (url.protocol !== 'http:' && url.protocol !== 'https:') ||
            url.username ||
            url.password ||
            value.includes('@') ||
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

function isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.toLowerCase()

    if (normalized === 'localhost' || normalized === '[::1]' || normalized === '::1') {
        return true
    }

    const octets = normalized.split('.')
    return (
        octets.length === 4 &&
        octets[0] === '127' &&
        octets.slice(1).every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
    )
}

export function parseTrustedManagementOrigin(configured: string | undefined): string | null {
    if (configured === undefined) return null
    const origin = normalizeHttpOrigin(configured.trim())
    if (!origin) return null

    const url = new URL(origin)
    return url.protocol === 'https:' ||
        (url.protocol === 'http:' && isLoopbackHostname(url.hostname))
        ? origin
        : null
}

export function parsePublicOrigin(
    configured: string | undefined,
    environment: ManagementOriginEnvironment = 'development',
): string | null {
    const origin = parseTrustedManagementOrigin(configured)
    if (!origin) return null
    if (environment === 'production' && !origin.startsWith('https:')) return null
    return origin
}
