import '@tanstack/react-start/server-only'

const DEFAULT_CONTROLLER_BASE_URL = 'http://127.0.0.1:8081'

function normalizeControllerBaseUrl(value: string): string | null {
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

        return url.toString().replace(/\/$/, '')
    } catch {
        return null
    }
}

export function getControllerBaseUrl(): string | null {
    const configured = process.env.RENTNERPROXY_CONTROLLER_URL

    if (configured === undefined) {
        return DEFAULT_CONTROLLER_BASE_URL
    }

    return normalizeControllerBaseUrl(configured.trim())
}

function normalizeDatabaseUrl(value: string): string | null {
    try {
        const url = new URL(value)

        if (
            (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
            !url.hostname ||
            url.pathname.length <= 1 ||
            url.hash
        ) {
            return null
        }

        return url.toString()
    } catch {
        return null
    }
}

export function parseDatabaseUrl(configured: string | undefined): string | null {
    if (configured === undefined) {
        return null
    }

    return normalizeDatabaseUrl(configured.trim())
}

export function getDatabaseUrl(): string | null {
    return parseDatabaseUrl(process.env.DATABASE_URL)
}
