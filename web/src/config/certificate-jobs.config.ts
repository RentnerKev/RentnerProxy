export const CERTIFICATE_JOB_STAGES = [
    'preparing',
    'issuing',
    'applying',
    'applied',
    'failed',
    'needs_attention',
] as const

export const CERTIFICATE_JOB_SUCCESS_VISIBILITY_MS = 30_000
export const CERTIFICATE_JOB_SUCCESS_TOAST_DURATION_MS = 5_000
