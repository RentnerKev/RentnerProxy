import { randomBytes } from 'node:crypto'

export function createDevelopmentEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
    const developmentEnvironment = { ...environment }

    if (
        !developmentEnvironment.RENTNERPROXY_CONTROLLER_TOKEN?.trim() &&
        !developmentEnvironment.RENTNERPROXY_CONTROLLER_TOKEN_FILE
    ) {
        developmentEnvironment.RENTNERPROXY_CONTROLLER_TOKEN = randomBytes(32).toString('base64url')
    }

    if (platform === 'win32') {
        developmentEnvironment.RENTNERPROXY_NATIVE_CONTROLLER_DEV = '1'
    } else {
        delete developmentEnvironment.RENTNERPROXY_NATIVE_CONTROLLER_DEV
    }

    return developmentEnvironment
}
