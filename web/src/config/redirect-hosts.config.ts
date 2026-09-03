export const REDIRECT_HOST_STATUS_CODES = [301, 302, 307, 308] as const

export type RedirectHostStatusCode = (typeof REDIRECT_HOST_STATUS_CODES)[number]

export const MAX_REDIRECT_HOST_DOMAINS = 50
export const MAX_REDIRECT_DESTINATION_LENGTH = 2_048
