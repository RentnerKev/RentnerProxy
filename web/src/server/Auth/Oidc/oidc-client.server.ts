import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import * as oidc from 'openid-client'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import type {
    OidcAuthorizationRequest,
    OidcClientConfiguration,
    OidcVerifiedIdentity,
} from './Types/oidc.types.ts'
import type { OidcProtocolOptions } from './Types/oidc-client.types.ts'
import { OidcDomainError } from './oidc.errors.ts'
import { createOidcHttpFetch, validateOidcEndpoint } from './oidc-http.server.ts'

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Caches bounded provider metadata while requiring cryptographically verified OIDC code exchanges. */
export function createOidcProtocolClient(options: OidcProtocolOptions = {}) {
    const now = options.now ?? Date.now
    const cache = new Map<string, { expires: number; pending: Promise<oidc.Configuration> }>()
    const validUntil = new WeakMap<oidc.Configuration, number>()

    async function getConfiguration(
        configuration: OidcClientConfiguration,
    ): Promise<oidc.Configuration> {
        const fingerprint = createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
        for (const [key, value] of cache) if (value.expires <= now()) cache.delete(key)
        const existing = cache.get(fingerprint)
        if (existing) return existing.pending
        if (cache.size >= OIDC_LIMITS.cacheEntries)
            throw new OidcDomainError('provider_unavailable')
        const expires = now() + OIDC_LIMITS.discoveryCacheMs
        const pending = (async () => {
            const fetch = (options.fetch ?? createOidcHttpFetch)(configuration)
            const pendingGets = new Map<string, Promise<Response>>()
            const readDocument: oidc.CustomFetch = async (url, init) => {
                if (expires <= now()) throw new OidcDomainError('provider_unavailable')
                validateOidcEndpoint(url, configuration)
                const response = await fetch(url, init)
                if (!response.ok) throw new OidcDomainError('provider_unavailable')
                // The production transport already bounds reads; enforce the JSON/key
                // bounds here too so every protocol document has the same policy.
                const text = await response.text()
                if (Buffer.byteLength(text) > OIDC_LIMITS.responseBytes)
                    throw new OidcDomainError('provider_unavailable')
                const json: unknown = JSON.parse(text)
                if (
                    !record(json) ||
                    ('keys' in json &&
                        (!Array.isArray(json.keys) || json.keys.length > OIDC_LIMITS.jwksKeys))
                )
                    throw new OidcDomainError('provider_unavailable')
                return new Response(text, { status: response.status, headers: response.headers })
            }
            const checkedFetch: oidc.CustomFetch = async (url, init) => {
                if (init.method !== 'GET') return readDocument(url, init)
                let pendingGet = pendingGets.get(url)
                if (!pendingGet) {
                    pendingGet = readDocument(url, init)
                    pendingGets.set(url, pendingGet)
                }
                try {
                    return (await pendingGet).clone()
                } finally {
                    if (pendingGets.get(url) === pendingGet) pendingGets.delete(url)
                }
            }
            const issuer = validateOidcEndpoint(configuration.issuer, configuration)
            const discovery = new URL(
                issuer.href.replace(/\/$/, '') + '/.well-known/openid-configuration',
            )
            const response = await checkedFetch(discovery.href, {
                method: 'GET',
                headers: { accept: 'application/json' },
                body: undefined,
                redirect: 'manual',
            })
            const metadata: unknown = await response.json()
            if (
                !record(metadata) ||
                metadata.issuer !== configuration.issuer ||
                typeof metadata.authorization_endpoint !== 'string' ||
                typeof metadata.token_endpoint !== 'string' ||
                typeof metadata.jwks_uri !== 'string' ||
                !Array.isArray(metadata.id_token_signing_alg_values_supported) ||
                !metadata.id_token_signing_alg_values_supported.includes('RS256')
            )
                throw new OidcDomainError('provider_unavailable')
            for (const endpoint of [
                metadata.authorization_endpoint,
                metadata.token_endpoint,
                metadata.jwks_uri,
            ])
                validateOidcEndpoint(endpoint, configuration)
            if (
                metadata.code_challenge_methods_supported !== undefined &&
                (!Array.isArray(metadata.code_challenge_methods_supported) ||
                    !metadata.code_challenge_methods_supported.includes('S256'))
            )
                throw new OidcDomainError('provider_unavailable')
            const client = new oidc.Configuration(
                {
                    issuer: configuration.issuer,
                    authorization_endpoint: metadata.authorization_endpoint,
                    token_endpoint: metadata.token_endpoint,
                    jwks_uri: metadata.jwks_uri,
                    id_token_signing_alg_values_supported: ['RS256'],
                    ...(metadata.authorization_response_iss_parameter_supported === true
                        ? { authorization_response_iss_parameter_supported: true }
                        : {}),
                },
                configuration.clientId,
                {
                    client_secret: configuration.clientSecret,
                    id_token_signed_response_alg: 'RS256',
                    [oidc.clockTolerance]: 0,
                },
                configuration.tokenEndpointAuthMethod === 'client_secret_basic'
                    ? oidc.ClientSecretBasic(configuration.clientSecret)
                    : oidc.ClientSecretPost(configuration.clientSecret),
            )
            client[oidc.customFetch] = checkedFetch
            client.timeout = OIDC_LIMITS.requestTimeoutMs / 1000
            oidc.enableNonRepudiationChecks(client)
            if (expires <= now()) throw new OidcDomainError('provider_unavailable')
            validUntil.set(client, expires)
            return client
        })()
        cache.set(fingerprint, { expires, pending })
        try {
            return await pending
        } catch {
            cache.delete(fingerprint)
            throw new OidcDomainError('provider_unavailable')
        }
    }

    return {
        async buildAuthorizationUrl(
            configuration: OidcClientConfiguration,
            request: OidcAuthorizationRequest,
        ): Promise<URL> {
            const client = await getConfiguration(configuration)
            return oidc.buildAuthorizationUrl(client, {
                redirect_uri: request.redirectUri,
                response_type: 'code',
                response_mode: 'query',
                scope: 'openid',
                state: request.state,
                nonce: request.nonce,
                code_challenge_method: 'S256',
                code_challenge: await oidc.calculatePKCECodeChallenge(request.codeVerifier),
            })
        },
        async exchangeAuthorizationCode(
            configuration: OidcClientConfiguration,
            request: OidcAuthorizationRequest,
            callbackUrl: URL,
        ): Promise<OidcVerifiedIdentity> {
            const client = await getConfiguration(configuration)
            try {
                const callbackBase = new URL(callbackUrl)
                callbackBase.search = ''
                callbackBase.hash = ''
                if (callbackUrl.hash || callbackBase.href !== request.redirectUri) throw new Error()
                const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, {
                    expectedState: request.state,
                    expectedNonce: request.nonce,
                    pkceCodeVerifier: request.codeVerifier,
                    idTokenExpected: true,
                })
                if ((validUntil.get(client) ?? 0) <= now()) throw new Error()
                const claims = tokens.claims()
                const seconds = Math.floor(Date.now() / 1000)
                if (
                    !claims ||
                    claims.iss !== configuration.issuer ||
                    typeof claims.sub !== 'string' ||
                    claims.sub.length === 0 ||
                    claims.sub.length > 255 ||
                    !/^[\x21-\x7e]+$/.test(claims.sub) ||
                    typeof claims.iat !== 'number' ||
                    !Number.isFinite(claims.iat) ||
                    claims.iat > seconds ||
                    typeof claims.exp !== 'number' ||
                    !Number.isFinite(claims.exp) ||
                    claims.exp <= seconds ||
                    claims.exp <= claims.iat ||
                    (claims.azp !== undefined && claims.azp !== configuration.clientId) ||
                    (Array.isArray(claims.aud) &&
                        claims.aud.length > 1 &&
                        claims.azp !== configuration.clientId)
                )
                    throw new Error()
                return { issuer: claims.iss, subject: claims.sub }
            } catch {
                throw new OidcDomainError('authentication_failed')
            }
        },
    }
}

export const oidcProtocolClient = createOidcProtocolClient()
