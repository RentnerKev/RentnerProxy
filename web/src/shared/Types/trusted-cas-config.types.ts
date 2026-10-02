import { TRUSTED_CA_ERROR_CODES } from '@/config/trusted-cas.config.ts'
export type TrustedCaErrorCode = (typeof TRUSTED_CA_ERROR_CODES)[number]
