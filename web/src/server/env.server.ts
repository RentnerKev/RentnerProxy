import '@tanstack/react-start/server-only'

import { isIP } from 'node:net'

import { APP_ENCRYPTION_KEY_BYTES, WEBAUTHN_RP_NAME } from '../config/auth-security.config'

const DEFAULT_APP_URL = 'http://localhost:5173'
const DEFAULT_CONTROLLER_BASE_URL = 'http://127.0.0.1:8081'
const SMTP_FROM_ADDRESS_PATTERN =
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

export interface SmtpConfiguration {
    readonly from: string
    readonly host: string
    readonly password?: string
    readonly port: number
    readonly secure: boolean
    readonly user?: string
}

export interface WebAuthnConfiguration {
    readonly origin: string
    readonly rpId: string
    readonly rpName: string
}

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

    return normalizeHttpOrigin(configured.trim())
}

export function getControllerToken(): string | null {
    const token = process.env.RENTNERPROXY_CONTROLLER_TOKEN?.trim() ?? ''
    return token === '' || /^[A-Za-z0-9_-]{32,256}$/u.test(token) ? token : null
}

export function isLoopbackControllerUrl(baseUrl: string): boolean {
    const hostname = new URL(baseUrl).hostname
    return (
        hostname === 'localhost' ||
        hostname === '[::1]' ||
        (isIP(hostname) === 4 && hostname.startsWith('127.'))
    )
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

export function validateDatabaseEnvironment(): { readonly DATABASE_URL: string } {
    const DATABASE_URL = getDatabaseUrl()

    if (!DATABASE_URL) {
        throw new Error('DATABASE_URL is missing or invalid.')
    }

    return { DATABASE_URL }
}

export function parseRedisUrl(configured: string | undefined): string | null {
    if (configured === undefined) {
        return null
    }

    try {
        const url = new URL(configured.trim())
        const validDatabasePath =
            url.pathname === '' || url.pathname === '/' || /^\/\d+$/.test(url.pathname)

        if (
            (url.protocol !== 'redis:' && url.protocol !== 'rediss:') ||
            !url.hostname ||
            !validDatabasePath ||
            url.search ||
            url.hash
        ) {
            return null
        }

        return url.toString().replace(/\/$/, '')
    } catch {
        return null
    }
}

export function getRedisUrl(): string | null {
    return parseRedisUrl(process.env.REDIS_URL)
}

export function parseAppUrl(configured: string | undefined): string | null {
    if (configured === undefined) {
        return process.env.NODE_ENV === 'production' ? null : DEFAULT_APP_URL
    }

    const appUrl = normalizeHttpOrigin(configured.trim())

    if (!appUrl || (process.env.NODE_ENV === 'production' && !appUrl.startsWith('https://'))) {
        return null
    }

    return appUrl
}

export function getAppUrl(): string | null {
    return parseAppUrl(process.env.APP_URL)
}

export function parseAppEncryptionKey(configured: string | undefined): Uint8Array | null {
    if (configured === undefined) {
        return null
    }

    const value = configured.trim()

    if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
        return null
    }

    try {
        const decoded = Buffer.from(value, 'base64')

        if (
            decoded.byteLength !== APP_ENCRYPTION_KEY_BYTES ||
            decoded.toString('base64') !== value
        ) {
            return null
        }

        return new Uint8Array(decoded)
    } catch {
        return null
    }
}

export function getAppEncryptionKey(): Uint8Array | null {
    return parseAppEncryptionKey(process.env.APP_ENCRYPTION_KEY)
}

export function parseWebAuthnRpId(
    configured: string | undefined,
    appUrl: string | null,
): string | null {
    if (configured === undefined || !appUrl) {
        return null
    }

    const rpId = configured.trim().toLowerCase()

    // Loopback IPs can be secure contexts, but WebAuthn still requires a domain RP ID.
    if (
        isIP(rpId) !== 0 ||
        !/^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)$/.test(
            rpId,
        )
    ) {
        return null
    }

    const hostname = new URL(appUrl).hostname.toLowerCase()

    if (hostname !== rpId) {
        return null
    }

    return rpId
}

export function getWebAuthnConfiguration(): WebAuthnConfiguration | null {
    const origin = getAppUrl()
    const rpId = parseWebAuthnRpId(process.env.WEBAUTHN_RP_ID, origin)

    return origin && rpId ? { origin, rpId, rpName: WEBAUTHN_RP_NAME } : null
}

export function getTrustProxyHeaders(): boolean {
    const configured = process.env.RENTNERPROXY_TRUST_PROXY_HEADERS
    return configured === undefined ? false : parseStrictBoolean(configured.trim()) === true
}

export function validateProductionEnvironment(): void {
    const invalidVariables: string[] = []
    const databaseUrl = getDatabaseUrl()
    const redisUrl = getRedisUrl()
    const appUrl = getAppUrl()
    const appEncryptionKey = getAppEncryptionKey()
    const webAuthn = getWebAuthnConfiguration()
    const controllerUrl = getControllerBaseUrl()
    const controllerToken = getControllerToken()
    const trustProxyHeaders = process.env.RENTNERPROXY_TRUST_PROXY_HEADERS

    if (!databaseUrl) invalidVariables.push('DATABASE_URL')
    if (!redisUrl) invalidVariables.push('REDIS_URL')
    if (!appUrl || !appUrl.startsWith('https://')) invalidVariables.push('APP_URL')
    if (!appEncryptionKey) invalidVariables.push('APP_ENCRYPTION_KEY')
    if (!webAuthn) invalidVariables.push('WEBAUTHN_RP_ID')
    if (!process.env.RENTNERPROXY_CONTROLLER_URL?.trim() || !controllerUrl)
        invalidVariables.push('RENTNERPROXY_CONTROLLER_URL')
    if (!controllerToken) invalidVariables.push('RENTNERPROXY_CONTROLLER_TOKEN')
    if (trustProxyHeaders !== undefined && parseStrictBoolean(trustProxyHeaders.trim()) === null) {
        invalidVariables.push('RENTNERPROXY_TRUST_PROXY_HEADERS')
    }

    if (invalidVariables.length > 0) {
        throw new Error(
            'Invalid production environment. Check: ' + invalidVariables.join(', ') + '.',
        )
    }
}

function parseSmtpHost(value: string): string | null {
    try {
        const url = new URL(`smtp://${value}`)

        if (
            !url.hostname ||
            url.username ||
            url.password ||
            url.port ||
            url.pathname !== '' ||
            url.search ||
            url.hash
        ) {
            return null
        }

        return url.hostname
    } catch {
        return null
    }
}

function parseSmtpPort(value: string): number | null {
    if (!/^[1-9]\d{0,4}$/.test(value)) {
        return null
    }

    const port = Number(value)
    return port <= 65_535 ? port : null
}

function parseStrictBoolean(value: string): boolean | null {
    if (value === 'true') {
        return true
    }

    if (value === 'false') {
        return false
    }

    return null
}

function parseSmtpFrom(value: string): string | null {
    if (
        !value ||
        Array.from(value).some((character) => {
            const codePoint = character.codePointAt(0)
            return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
        })
    ) {
        return null
    }

    const mailboxMatch = /^(?:([^<>]+)\s+<([^<>]+)>|([^<>]+))$/.exec(value)

    if (!mailboxMatch) {
        return null
    }

    const address = mailboxMatch[2] ?? mailboxMatch[3]
    return address && SMTP_FROM_ADDRESS_PATTERN.test(address) ? value : null
}

export function getSmtpConfiguration(): SmtpConfiguration | null {
    const hostValue = process.env.SMTP_HOST
    const portValue = process.env.SMTP_PORT
    const secureValue = process.env.SMTP_SECURE
    const fromValue = process.env.SMTP_FROM
    const userValue = process.env.SMTP_USER
    const passwordValue = process.env.SMTP_PASSWORD

    if (
        hostValue === undefined ||
        portValue === undefined ||
        secureValue === undefined ||
        fromValue === undefined
    ) {
        return null
    }

    const host = parseSmtpHost(hostValue.trim())
    const port = parseSmtpPort(portValue.trim())
    const secure = parseStrictBoolean(secureValue.trim())
    const from = parseSmtpFrom(fromValue.trim())
    const user = userValue?.trim() ?? ''
    const password = passwordValue?.trim() ?? ''
    const hasUser = user.length > 0
    const hasPassword = password.length > 0

    if (!host || port === null || secure === null || !from || hasUser !== hasPassword) {
        return null
    }

    if (!hasUser && !hasPassword) {
        return { from, host, port, secure }
    }

    return { from, host, password, port, secure, user }
}
