const CSP_NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

export function isCspNonce(value: unknown): value is string {
    return typeof value === 'string' && CSP_NONCE_PATTERN.test(value)
}

export function getClientCspNonce(): string | undefined {
    if (typeof window === 'undefined') return undefined

    const globals = globalThis as typeof globalThis & { __webpack_nonce__?: unknown }
    // oxlint-disable-next-line no-underscore-dangle -- Read the nonce used by get-nonce for the current document.
    const nonce = globals.__webpack_nonce__
    return isCspNonce(nonce) ? nonce : undefined
}

export function setClientCspNonce(value: unknown): void {
    if (typeof window === 'undefined' || !isCspNonce(value)) return

    const globals = globalThis as typeof globalThis & {
        __webpack_nonce__?: string
    }
    // oxlint-disable-next-line no-underscore-dangle -- react-style-singleton reads this standard nonce hook through get-nonce.
    globals.__webpack_nonce__ = value
}
