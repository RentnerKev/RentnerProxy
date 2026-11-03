import '@tanstack/react-start/server-only'
import { createHash, createPublicKey } from 'node:crypto'
import * as oidc from 'openid-client'
import { OIDC_LIMITS } from '@/config/oidc.config.ts'
import type {
    OidcAuthorizationRequest,
    OidcClientConfiguration,
    OidcVerifiedIdentity,
} from './Types/oidc.types.ts'
import type { OidcProtocolOptions } from './Types/oidc-client.types.ts'
import { normalizeOidcFlowError, OidcDomainError } from './oidc.errors.ts'
import { createOidcHttpFetch, validateOidcEndpoint } from './oidc-http.server.ts'
import { readVerifiedOidcClaims } from './oidc-claims.server.ts'

/** Narrows untrusted protocol JSON without accepting arrays or null as metadata objects. */
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Recognizes SDK error classes after their state/issuer checks, without forwarding protocol payloads. */
function protocolFailure(error: unknown): OidcDomainError {
    if (
        error instanceof oidc.AuthorizationResponseError ||
        error instanceof oidc.ResponseBodyError
    ) {
        switch (error.error) {
            case 'access_denied':
            case 'consent_required':
            case 'interaction_required':
            case 'login_required':
            case 'account_selection_required':
                return new OidcDomainError('identity_not_allowed')
            case 'server_error':
            case 'temporarily_unavailable':
                return new OidcDomainError('provider_unavailable')
        }
    }
    if (error instanceof oidc.ClientError) {
        // openid-client wraps customFetch failures in ClientError.cause; only our own typed error is trusted.
        if (error.cause instanceof OidcDomainError) return normalizeOidcFlowError(error.cause)
        switch (error.code) {
            case 'OAUTH_TIMEOUT':
            case 'OAUTH_ABORT':
                return new OidcDomainError('provider_unavailable')
            case 'OAUTH_JWT_CLAIM_COMPARISON_FAILED':
            case 'OAUTH_JWT_TIMESTAMP_CHECK_FAILED':
                return new OidcDomainError('identity_not_allowed')
        }
    }
    return normalizeOidcFlowError(error)
}

/** Caches bounded provider metadata while requiring cryptographically verified OIDC code exchanges. */
export function createOidcProtocolClient(options: OidcProtocolOptions = {}) {
    const now = options.now ?? Date.now
    const cache = new Map<string, { expires: number; pending: Promise<oidc.Configuration> }>()
    const validUntil = new WeakMap<oidc.Configuration, number>()

    /** Reserves the caller's request budget without extending the metadata's absolute trust lifetime. */
    async function getConfiguration(
        configuration: OidcClientConfiguration,
        minimumLifetimeMs = 0,
        metadataProbe = false,
        signal?: AbortSignal,
    ): Promise<oidc.Configuration> {
        const fingerprint = createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
        for (const [key, value] of cache)
            if (value.expires <= now() + minimumLifetimeMs) cache.delete(key)
        if (metadataProbe) cache.delete(fingerprint)
        const existing = cache.get(fingerprint)
        if (existing) {
            const client = await existing.pending
            if ((validUntil.get(client) ?? 0) <= now() + minimumLifetimeMs)
                throw new OidcDomainError('provider_unavailable')
            return client
        }
        if (cache.size >= OIDC_LIMITS.cacheEntries) {
            const oldest = cache.keys().next().value
            if (oldest !== undefined) cache.delete(oldest)
        }
        const expires = now() + OIDC_LIMITS.discoveryCacheMs
        const pending = (async () => {
            const fetch = (options.fetch ?? createOidcHttpFetch)(configuration)
            const pendingGets = new Map<string, Promise<Response>>()
            /** Validates bounded provider JSON before discovery, token or key data reaches the protocol library. */
            async function readDocument(
                url: Parameters<oidc.CustomFetch>[0],
                init: Parameters<oidc.CustomFetch>[1],
            ): Promise<Response> {
                if (expires <= now()) throw new OidcDomainError('provider_unavailable')
                validateOidcEndpoint(url, configuration)
                const response = await fetch(url, { ...init, ...(signal ? { signal } : {}) })
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
            /** Coalesces metadata and key GETs while keeping token POSTs and their responses independent. */
            async function checkedFetch(
                url: Parameters<oidc.CustomFetch>[0],
                init: Parameters<oidc.CustomFetch>[1],
            ): Promise<Response> {
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
                    ...(metadataProbe ? {} : { client_secret: configuration.clientSecret }),
                    id_token_signed_response_alg: 'RS256',
                    [oidc.clockTolerance]: 0,
                },
                metadataProbe
                    ? oidc.None()
                    : configuration.tokenEndpointAuthMethod === 'client_secret_basic'
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
            const client = await pending
            if (expires <= now() + minimumLifetimeMs)
                throw new OidcDomainError('provider_unavailable')
            return client
        } catch {
            if (cache.get(fingerprint)?.pending === pending) cache.delete(fingerprint)
            throw new OidcDomainError('provider_unavailable')
        }
    }

    return {
        /** Probes fresh discovery and public signing keys without redeeming a code or opening credentials. */
        async verifyMetadata(configuration: OidcClientConfiguration): Promise<void> {
            const signal = AbortSignal.timeout(2 * OIDC_LIMITS.requestTimeoutMs)
            try {
                const client = await getConfiguration(configuration, 0, true, signal)
                const response = await client[oidc.customFetch]!(
                    client.serverMetadata().jwks_uri!,
                    {
                        method: 'GET',
                        headers: { accept: 'application/json' },
                        body: undefined,
                        redirect: 'manual',
                        signal,
                    },
                )
                const document: unknown = await response.json()
                if (
                    !record(document) ||
                    !Array.isArray(document.keys) ||
                    !document.keys.some((key: unknown) => {
                        if (
                            !record(key) ||
                            key.kty !== 'RSA' ||
                            typeof key.n !== 'string' ||
                            typeof key.e !== 'string' ||
                            (key.use !== undefined && key.use !== 'sig') ||
                            (key.alg !== undefined && key.alg !== 'RS256') ||
                            (key.key_ops !== undefined &&
                                (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify')))
                        )
                            return false
                        try {
                            const publicKey = createPublicKey({
                                key: { kty: 'RSA', n: key.n, e: key.e },
                                format: 'jwk',
                            })
                            return (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) >= 2048
                        } catch {
                            return false
                        }
                    }) ||
                    signal.aborted
                )
                    throw new Error()
            } catch {
                throw new OidcDomainError('provider_unavailable')
            }
        },
        /** Builds a code-only request with fresh browser state, nonce and S256 proof. */
        async buildAuthorizationUrl(
            configuration: OidcClientConfiguration,
            request: OidcAuthorizationRequest,
        ): Promise<URL> {
            const client = await getConfiguration(configuration)
            return oidc.buildAuthorizationUrl(client, {
                redirect_uri: request.redirectUri,
                response_type: 'code',
                response_mode: 'query',
                scope: configuration.groupClaim ? 'openid profile email' : 'openid',
                ...(request.prompt ? { prompt: request.prompt } : {}),
                state: request.state,
                nonce: request.nonce,
                code_challenge_method: 'S256',
                code_challenge: await oidc.calculatePKCECodeChallenge(request.codeVerifier),
            })
        },
        /** Verifies the complete code exchange and returns only its issuer-bound immutable subject. */
        async exchangeAuthorizationCode(
            configuration: OidcClientConfiguration,
            request: OidcAuthorizationRequest,
            callbackUrl: URL,
        ): Promise<OidcVerifiedIdentity> {
            // Refresh before redeeming a one-use code if token POST plus JWKS GET could outlive trust.
            const client = await getConfiguration(configuration, 2 * OIDC_LIMITS.requestTimeoutMs)
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
                // Only issuance allows clock skew; strict expiry never extends token validity.
                if (
                    !claims ||
                    claims.iss !== configuration.issuer ||
                    typeof claims.sub !== 'string' ||
                    claims.sub.length === 0 ||
                    claims.sub.length > 255 ||
                    !/^[\x21-\x7e]+$/.test(claims.sub) ||
                    typeof claims.iat !== 'number' ||
                    !Number.isFinite(claims.iat) ||
                    claims.iat > seconds + OIDC_LIMITS.issuedAtClockSkewSeconds ||
                    typeof claims.exp !== 'number' ||
                    !Number.isFinite(claims.exp) ||
                    claims.exp <= seconds ||
                    claims.exp <= claims.iat ||
                    (claims.azp !== undefined && claims.azp !== configuration.clientId) ||
                    (Array.isArray(claims.aud) &&
                        claims.aud.length > 1 &&
                        claims.azp !== configuration.clientId)
                )
                    throw new OidcDomainError('identity_not_allowed')
                try {
                    return readVerifiedOidcClaims(
                        { ...claims, iss: claims.iss, sub: claims.sub, exp: claims.exp },
                        configuration.groupClaim,
                    )
                } catch {
                    throw new OidcDomainError('identity_not_allowed')
                }
            } catch (error) {
                throw protocolFailure(error)
            }
        },
    }
}

export const oidcProtocolClient = createOidcProtocolClient()
