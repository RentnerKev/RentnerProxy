declare const RENTNERPROXY_BUILD_VERSION: string

export const APP_VERSION =
    typeof RENTNERPROXY_BUILD_VERSION === 'string' ? RENTNERPROXY_BUILD_VERSION : '0.0.0-dev'
