export function createDevelopmentEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
    const developmentEnvironment = { ...environment }

    if (platform === 'win32') {
        developmentEnvironment.RENTNERPROXY_NATIVE_CONTROLLER_DEV = '1'
    } else {
        delete developmentEnvironment.RENTNERPROXY_NATIVE_CONTROLLER_DEV
    }

    return developmentEnvironment
}
