import { DEFAULT_APP_VERSION } from '@/config/version.config.ts'

declare const RENTNERPROXY_BUILD_VERSION: string

export const APP_VERSION =
    typeof RENTNERPROXY_BUILD_VERSION === 'string'
        ? RENTNERPROXY_BUILD_VERSION
        : DEFAULT_APP_VERSION
