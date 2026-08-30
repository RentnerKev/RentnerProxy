export const USER_STATUSES = ['pending', 'active', 'disabled'] as const

export const PASSWORD_MAX_LENGTH = 256

export const SESSION_COOKIE_NAME = 'rentnerproxy_session'
export const MFA_CHALLENGE_COOKIE_NAME = 'rentnerproxy_auth_challenge'
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_LAST_SEEN_INTERVAL_MS = 15 * 60 * 1000

export const PASSWORD_RESET_DURATION_MS = 30 * 60 * 1000
export const USER_INVITE_DURATION_MS = 24 * 60 * 60 * 1000

export const OPAQUE_TOKEN_BYTES = 32
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export const FIRST_OWNER_ADVISORY_LOCK_ID = 7_421_906
export const ACTIVE_OWNER_ADVISORY_LOCK_ID = 7_421_907
