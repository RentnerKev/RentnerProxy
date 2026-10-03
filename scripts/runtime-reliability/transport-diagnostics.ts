import type {
    TrafficDiagnostic,
    TrafficObservation,
    TransportFailureCategory,
} from './Types/fixture-transport.types.ts'

export function createTrafficObserver() {
    let observation: TrafficObservation | null = null
    let failed = false
    return {
        observe(value: TrafficObservation) {
            if (!failed) observation = value
        },
        recordFailure(value: TrafficObservation) {
            if (failed) return
            observation = value
            failed = true
        },
        reset() {
            observation = null
            failed = false
        },
        clearHealthyObservation() {
            if (!failed) observation = null
        },
        get observation() {
            return observation
        },
    }
}

function classify(message: string): TransportFailureCategory {
    if (/no such host|lookup .* (?:timeout|failure)/u.test(message)) return 'dns-lookup'
    if (/dial tcp.*i\/o timeout/u.test(message)) return 'tcp-dial-timeout'
    if (/dial tcp.*connection refused/u.test(message)) return 'tcp-dial-refused'
    if (/dial udp/u.test(message)) return 'upstream-error'
    if (/connection reset by peer/u.test(message)) return 'connection-reset'
    if (/\bEOF\b/u.test(message)) return 'unexpected-eof'
    if (/tls:|x509:/u.test(message)) return 'tls-failure'
    if (/timeout/u.test(message)) return 'response-timeout'
    return 'upstream-error'
}

export function caddyTransportErrors(log: string): TrafficDiagnostic['caddy'] {
    const events: TrafficDiagnostic['caddy'] = []
    for (const line of log.slice(-256_000).split('\n').slice(-200)) {
        let input: unknown
        try {
            input = JSON.parse(line)
        } catch {
            continue
        }
        if (!input || typeof input !== 'object' || Array.isArray(input)) continue
        const record = input as Record<string, unknown>
        if (
            record.logger !== 'http.log.error' ||
            record.level !== 'error' ||
            typeof record.status !== 'number' ||
            !Number.isInteger(record.status) ||
            record.status < 400 ||
            record.status > 599 ||
            typeof record.msg !== 'string'
        )
            continue
        const category = classify(record.msg)
        events.push({
            category,
            status: record.status,
            newTcpDial: category.startsWith('tcp-dial-'),
        })
    }
    return events.slice(-8)
}

export function hostFetchCode(error: unknown): string {
    const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
    const allowed = [
        'ConnectionRefused',
        'ConnectionClosed',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'TimeoutError',
        'AbortError',
    ]
    return allowed.find((code) => record.code === code || record.name === code) ?? 'unexpected'
}
