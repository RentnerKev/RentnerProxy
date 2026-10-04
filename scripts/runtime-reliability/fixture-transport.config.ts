export const fixtureTransport = {
    hostname: 'fixture-upstream',
    primaryPort: 9000,
    secondaryPort: 9001,
    authPort: 9002,
    tlsPort: 9003,
    controlPort: 9004,
    idleTimeout: 255,
} as const
