import '@tanstack/react-start/server-only'
import { z } from 'zod'
import { MFA_CHALLENGE_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/config/auth.config.ts'
import {
    OIDC_CALLBACK_PATH,
    OIDC_FLOW_COOKIE_NAME,
    OIDC_DEVELOPMENT_FLOW_COOKIE_NAME,
    OIDC_LINK_FLOW_COOKIE_NAME,
    OIDC_DEVELOPMENT_LINK_FLOW_COOKIE_NAME,
    OIDC_LIMITS,
    OIDC_RATE_LIMIT,
} from '@/config/oidc.config.ts'
import { readBoundedStream } from '@/lib/Http/readBoundedStream.ts'
import { getPublicOrigin } from '@/server/env.server.ts'
import { getCurrentSessionService } from '@/server/Auth/Access/sessions.service.ts'
import { isValidOpaqueToken } from '@/server/Auth/Core/tokens.server.ts'
import { consumeRateLimit } from '@/server/Valkey/rate-limiter.service.ts'
import {
    beginOidcLoginService,
    beginOidcLinkService,
    completeOidcLoginService,
} from './oidc-login.service.ts'
import { getOidcClientIp } from './oidc-request-ip.server.ts'
import type { OidcHttpHandlerDependencies } from './Types/oidc-response.types.ts'

const forbiddenCallbackKeys = new Set([
    'access_token',
    'id_token',
    'refresh_token',
    'token_type',
    'response',
])

function responseHeaders() {
    return new Headers({
        'Cache-Control': 'private, no-store',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
    })
}

/** Uses a browser-enforced host-only binding on HTTPS and a distinct development cookie on HTTP. */
function flowCookieName(origin: string, link = false): string {
    if (link)
        return new URL(origin).protocol === 'https:'
            ? OIDC_LINK_FLOW_COOKIE_NAME
            : OIDC_DEVELOPMENT_LINK_FLOW_COOKIE_NAME
    return new URL(origin).protocol === 'https:'
        ? OIDC_FLOW_COOKIE_NAME
        : OIDC_DEVELOPMENT_FLOW_COOKIE_NAME
}

/** Rejects duplicate, malformed or oversized browser bindings before any exchange is consumed. */
function flowCookie(request: Request, origin: string, link = false): string | null {
    const name = flowCookieName(origin, link)
    const header = request.headers.get('cookie') ?? ''
    if (header.length > OIDC_LIMITS.cookieHeaderBytes) return null
    const matches = header
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.startsWith(name + '='))
    if (matches.length !== 1) return null
    const value = matches[0]!.slice(name.length + 1)
    return isValidOpaqueToken(value) ? value : null
}

/** Formats an opaque authentication cookie with the existing HttpOnly/Lax session contract. */
function cookie(name: string, value: string, path: string, expiresAt: Date, origin: string) {
    if (value && !isValidOpaqueToken(value)) throw new Error('invalid_cookie')
    return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${new URL(origin).protocol === 'https:' ? '; Secure' : ''}`
}

function redirect(
    path: '/' | '/login/two-factor' | '/login?oidcError=failed',
    headers = responseHeaders(),
) {
    headers.set('Location', path)
    return new Response(null, { status: 303, headers })
}

/** Commits a same-origin document before navigation, retaining CSP restrictions on native form submissions. */
function authorizationNavigationResponse(authorizationUrl: URL, headers: Headers): Response {
    const destination = authorizationUrl.href
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
    headers.set('Content-Type', 'text/html; charset=utf-8')
    return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${destination}"><title>Continue sign-in</title></head><body><a href="${destination}" rel="noreferrer">Continue sign-in</a></body></html>`,
        { status: 200, headers },
    )
}

/** Accepts privacy-suppressed Origin only with browser-controlled proof of a same-origin document navigation. */
function isSameOriginLoginStart(request: Request, origin: string): boolean {
    const suppliedOrigin = request.headers.get('origin')
    if (suppliedOrigin === origin) return true
    if (suppliedOrigin !== null && suppliedOrigin !== 'null') return false
    return (
        request.headers.get('sec-fetch-site') === 'same-origin' &&
        request.headers.get('sec-fetch-mode') === 'navigate' &&
        request.headers.get('sec-fetch-dest') === 'document'
    )
}

/** Raw auth endpoints expose only navigation destinations and fixed callback/error redirects. */
export function createOidcHttpHandlers(dependencies: OidcHttpHandlerDependencies) {
    return {
        /** Accepts a bounded same-origin provider selection and starts a native browser navigation. */
        async start(request: Request): Promise<Response> {
            const headers = responseHeaders()
            if (request.method !== 'POST') return new Response(null, { status: 405, headers })
            const origin = dependencies.origin()
            if (!origin || !isSameOriginLoginStart(request, origin))
                return new Response(null, { status: 403, headers })
            if (
                request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
                'application/x-www-form-urlencoded'
            )
                return new Response(null, { status: 415, headers })
            try {
                await dependencies.limit()
                if (!request.body) throw new Error('invalid_input')
                const signal = AbortSignal.any([
                    request.signal,
                    AbortSignal.timeout(OIDC_LIMITS.inputTimeoutMs),
                ])
                const bytes = await readBoundedStream(
                    request.body,
                    OIDC_LIMITS.startBodyBytes,
                    signal,
                )
                const body = new URLSearchParams(
                    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                )
                const linking = body.get('intent') === 'link'
                if (
                    [...body.keys()].length !== (linking ? 2 : 1) ||
                    body.getAll('providerId').length !== 1 ||
                    (linking && body.getAll('intent').length !== 1)
                )
                    throw new Error('invalid_input')
                const signedIn = await dependencies.signedIn()
                if (signedIn && !linking) return redirect('/')
                if (linking && (!signedIn || !dependencies.beginLink))
                    throw new Error('invalid_input')
                const providerId = z.uuid().parse(body.get('providerId'))
                const result = linking
                    ? await dependencies.beginLink!(providerId)
                    : await dependencies.begin(providerId)
                headers.append(
                    'Set-Cookie',
                    cookie(
                        flowCookieName(origin, linking),
                        result.browserToken,
                        '/',
                        result.expiresAt,
                        origin,
                    ),
                )
                return authorizationNavigationResponse(result.authorizationUrl, headers)
            } catch {
                return redirect('/login?oidcError=failed', headers)
            }
        },
        /** Issues existing local session/MFA cookies only after a verified exchange, with fixed safe redirects. */
        async callback(request: Request): Promise<Response> {
            const headers = responseHeaders()
            if (request.method !== 'GET') return new Response(null, { status: 405, headers })
            const origin = dependencies.origin()
            if (!origin) return new Response(null, { status: 503, headers })
            try {
                await dependencies.limit()
                const signedIn = await dependencies.signedIn()
                const linkToken = flowCookie(request, origin, true)
                if (signedIn && !linkToken) return redirect('/', headers)
                const incoming = new URL(request.url)
                if (
                    incoming.pathname !== OIDC_CALLBACK_PATH ||
                    incoming.search.length > OIDC_LIMITS.callbackBytes
                )
                    throw new Error('invalid_input')
                for (const key of incoming.searchParams.keys())
                    if (
                        forbiddenCallbackKeys.has(key) ||
                        incoming.searchParams.getAll(key).length !== 1
                    )
                        throw new Error('invalid_input')
                const browserToken = signedIn ? linkToken : flowCookie(request, origin)
                if (!browserToken) throw new Error('invalid_input')
                const canonical = new URL(OIDC_CALLBACK_PATH, origin)
                // Behind Caddy the internal Request origin may differ; only PUBLIC_ORIGIN defines the registered callback.
                canonical.search = incoming.search
                const result = await dependencies.complete(canonical, browserToken, signedIn)
                if (!result.success) throw new Error('authentication_failed')
                if ('linked' in result) {
                    if (!signedIn || !linkToken) throw new Error('authentication_failed')
                    headers.append(
                        'Set-Cookie',
                        cookie(flowCookieName(origin, true), '', '/', new Date(0), origin),
                    )
                    headers.set('Location', '/account')
                    return new Response(null, { status: 303, headers })
                }
                headers.append(
                    'Set-Cookie',
                    cookie(flowCookieName(origin), '', '/', new Date(0), origin),
                )
                headers.append(
                    'Set-Cookie',
                    cookie(MFA_CHALLENGE_COOKIE_NAME, '', '/', new Date(0), origin),
                )
                if (result.requiresTwoFactor) {
                    headers.append(
                        'Set-Cookie',
                        cookie(
                            MFA_CHALLENGE_COOKIE_NAME,
                            result.challenge.id,
                            '/',
                            result.challenge.expiresAt,
                            origin,
                        ),
                    )
                    return redirect('/login/two-factor', headers)
                }
                headers.append(
                    'Set-Cookie',
                    cookie(
                        SESSION_COOKIE_NAME,
                        result.session.token,
                        '/',
                        result.session.expiresAt,
                        origin,
                    ),
                )
                return redirect('/', headers)
            } catch {
                return redirect('/login?oidcError=failed', headers)
            }
        },
    }
}

export const oidcHttpHandlers = createOidcHttpHandlers({
    origin: getPublicOrigin,
    begin: beginOidcLoginService,
    beginLink: beginOidcLinkService,
    complete: completeOidcLoginService,
    limit: async () => {
        await consumeRateLimit({ ...OIDC_RATE_LIMIT, identifier: getOidcClientIp() })
    },
    signedIn: async () => Boolean(await getCurrentSessionService()),
})
