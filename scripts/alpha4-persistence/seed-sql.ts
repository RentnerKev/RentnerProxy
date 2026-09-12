import type { Alpha4CertificateRequest, Alpha4PersistenceIds } from './types'
import { digest, encryptRequest, uuidV7 } from './crypto'
import { sqlJson, sqlQuote, sqlTextArray, sqlTimestamp } from './storage'

const futureAttemptAt = '2099-01-01T00:00:00.000Z'
const futureLeaseExpiresAt = '2099-01-02T00:00:00.000Z'

export function buildSeedStatements(
    ids: Alpha4PersistenceIds,
    input: { readonly runId: string },
    values: {
        readonly key: Buffer
        readonly now: Date
        readonly operationStartedAt: Date
        readonly lastSuccessAt: Date
        readonly lastAttemptAt: Date
        readonly certificateCreatedAt: Date
        readonly jobCreatedAt: Date
        readonly issuedAt: Date
        readonly expiresAt: Date
        readonly nextRenewalAt: Date
        readonly domain: string
        readonly identityDigest: string
        readonly request: Alpha4CertificateRequest
        readonly requestContext: string
        readonly cursorStatement: string
    },
): string[] {
    const host = {
        id: ids.hostId,
        forwardScheme: 'http',
        forwardHost: '127.0.0.1',
        forwardPort: 8080,
        enabled: false,
        certificateId: ids.certificateId,
        forceHttps: false,
        verifyUpstreamTls: true,
        upstreamTlsServerName: null,
        trustedCaId: null,
        accessPolicyId: null,
        createdAt: values.now,
        updatedAt: values.now,
    }
    const hostRevision = digest({ host, domains: [values.domain], httpSettings: {} })
    const requestDigest = digest({ proxyHostId: ids.hostId, host: null, request: values.request })
    const operation = {
        id: ids.operationId,
        kind: 'renew',
        stage: 'retry_scheduled',
        startedAt: values.operationStartedAt.toISOString(),
        updatedAt: values.now.toISOString(),
    }
    const encrypted = encryptRequest(values.request, values.key, values.requestContext)
    const certificateFingerprint = `sha256:${digest({ runId: input.runId, certificate: true })}`
    const leaseToken = uuidV7()
    return [
        'begin',
        'insert into rentnerproxy.users (id, display_name, email, status, created_at, updated_at) values (' +
            sqlQuote(ids.ownerUserId) +
            ', ' +
            sqlQuote(`Alpha 4 Fixture Owner ${input.runId}`) +
            ', ' +
            sqlQuote(`alpha4-${values.identityDigest.slice(0, 24)}@fixture.invalid`) +
            ", 'active', " +
            sqlTimestamp(values.certificateCreatedAt) +
            ', ' +
            sqlTimestamp(values.now) +
            ')',
        'insert into rentnerproxy.user_roles (user_id, role_id) select ' +
            sqlQuote(ids.ownerUserId) +
            ", id from rentnerproxy.roles where key = 'owner'",
        'insert into rentnerproxy.certificates (id, name, source, environment, status, operation, current_operation, challenge_type, issued_at, expires_at, issuer, fingerprint, candidate, dns_cleanup_pending, last_error_code, last_activated_at, last_error_at, next_attempt_at, attempt_count, last_attempt_at, last_success_at, next_renewal_at, controller_updated_at, created_at, updated_at) values (' +
            sqlQuote(ids.certificateId) +
            ', ' +
            sqlQuote(`Alpha 4 persistence ${input.runId}`) +
            ", 'acme', 'staging', 'valid', 'renewing', " +
            sqlJson(operation) +
            ", 'http-01', " +
            sqlTimestamp(values.issuedAt) +
            ', ' +
            sqlTimestamp(values.expiresAt) +
            ', ' +
            sqlQuote('Alpha 4 Fixture CA') +
            ', ' +
            sqlQuote(certificateFingerprint) +
            ', null, false, ' +
            sqlQuote('acme_failed') +
            ', ' +
            sqlTimestamp(values.lastSuccessAt) +
            ', ' +
            sqlTimestamp(values.lastAttemptAt) +
            ', ' +
            sqlTimestamp(futureAttemptAt) +
            ', 2, ' +
            sqlTimestamp(values.lastAttemptAt) +
            ', ' +
            sqlTimestamp(values.lastSuccessAt) +
            ', ' +
            sqlTimestamp(values.nextRenewalAt) +
            ', ' +
            sqlTimestamp(values.now) +
            ', ' +
            sqlTimestamp(values.certificateCreatedAt) +
            ', ' +
            sqlTimestamp(values.now) +
            ')',
        'insert into rentnerproxy.certificate_domains (certificate_id, domain, created_at) values (' +
            sqlQuote(ids.certificateId) +
            ', ' +
            sqlQuote(values.domain) +
            ', ' +
            sqlTimestamp(values.certificateCreatedAt) +
            ')',
        'insert into rentnerproxy.proxy_hosts (id, forward_scheme, forward_host, forward_port, enabled, certificate_id, force_https, verify_upstream_tls, upstream_tls_server_name, trusted_ca_id, access_policy_id, created_at, updated_at) values (' +
            sqlQuote(ids.hostId) +
            ", 'http', '127.0.0.1', 8080, false, " +
            sqlQuote(ids.certificateId) +
            ', false, true, null, null, null, ' +
            sqlTimestamp(values.now) +
            ', ' +
            sqlTimestamp(values.now) +
            ')',
        'insert into rentnerproxy.host_domains (proxy_host_id, domain, created_at) values (' +
            sqlQuote(ids.hostId) +
            ', ' +
            sqlQuote(values.domain) +
            ', ' +
            sqlTimestamp(values.now) +
            ')',
        'insert into rentnerproxy.certificate_binding_jobs (id, actor_user_id, proxy_host_id, certificate_id, idempotency_key, request_digest, domains, required_permissions, host_revision, assigned_revision, desired_enabled, desired_force_https, request_ciphertext, request_iv, stage, controller_stage, controller_operation_id, last_error_code, attempt_count, retry_requested, next_attempt_at, lease_token, lease_expires_at, created_at, updated_at) values (' +
            sqlQuote(ids.jobId) +
            ', ' +
            sqlQuote(ids.ownerUserId) +
            ', ' +
            sqlQuote(ids.hostId) +
            ', ' +
            sqlQuote(ids.certificateId) +
            ', ' +
            sqlQuote(ids.idempotencyKey) +
            ', ' +
            sqlQuote(requestDigest) +
            ', ' +
            sqlTextArray([values.domain]) +
            ', ' +
            sqlTextArray(['proxy_hosts.update', 'certificates.issue']) +
            ', ' +
            sqlQuote(hostRevision) +
            ', ' +
            sqlQuote(hostRevision) +
            ', false, false, decode(' +
            sqlQuote(encrypted.ciphertext.toString('base64')) +
            ", 'base64'), decode(" +
            sqlQuote(encrypted.iv.toString('base64')) +
            ", 'base64'), 'issuing', 'retry_scheduled', " +
            sqlQuote(ids.operationId) +
            ", 'acme_failed', 2, true, " +
            sqlTimestamp(futureAttemptAt) +
            ', ' +
            sqlQuote(leaseToken) +
            ', ' +
            sqlTimestamp(futureLeaseExpiresAt) +
            ', ' +
            sqlTimestamp(values.jobCreatedAt) +
            ', ' +
            sqlTimestamp(values.now) +
            ')',
        'insert into rentnerproxy.certificate_event_receipts (event_id, operation_id, certificate_id, kind, stage, occurred_at, error_code, received_at) values (' +
            sqlQuote(ids.eventIds[0]) +
            ', ' +
            sqlQuote(ids.operationId) +
            ', ' +
            sqlQuote(ids.certificateId) +
            ", 'started', 'creating_order', " +
            sqlTimestamp(values.operationStartedAt) +
            ', null, ' +
            sqlTimestamp(values.now) +
            '), (' +
            sqlQuote(ids.eventIds[1]) +
            ', ' +
            sqlQuote(ids.operationId) +
            ', ' +
            sqlQuote(ids.certificateId) +
            ", 'retry_scheduled', 'retry_scheduled', " +
            sqlTimestamp(values.lastAttemptAt) +
            ', ' +
            sqlQuote('acme_failed') +
            ', ' +
            sqlTimestamp(values.now) +
            ')',
        values.cursorStatement,
        'commit',
    ]
}
