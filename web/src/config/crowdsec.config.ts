export const CROWDSEC_MODES = ['disabled', 'managed', 'external'] as const
export type CrowdSecMode = (typeof CROWDSEC_MODES)[number]

export const CROWDSEC_API_URL_MAX_LENGTH = 2_048
export const CROWDSEC_API_KEY_MIN_LENGTH = 16
export const CROWDSEC_API_KEY_MAX_LENGTH = 512
export const CROWDSEC_ENROLLMENT_KEY_MAX_LENGTH = 256

export const CROWDSEC_SETTINGS_KEY = 'crowdsec_configuration_v1'
export const CROWDSEC_SECRET_CONTEXT = 'crowdsec_configuration_v1:external_api_key'
