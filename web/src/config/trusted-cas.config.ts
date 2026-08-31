export const MAX_TRUSTED_CA_PEM_BYTES = 256 * 1_024

export const TRUSTED_CA_ERROR_CODES = [
    'invalid_input',
    'trusted_ca_not_found',
    'trusted_ca_duplicate',
    'trusted_ca_in_use',
    'controller_unavailable',
] as const

export type TrustedCaErrorCode = (typeof TRUSTED_CA_ERROR_CODES)[number]
