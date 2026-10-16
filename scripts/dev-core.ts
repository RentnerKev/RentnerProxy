import { fileURLToPath } from 'node:url'

import { logger } from './lib/logger.ts'

export function createControllerDevelopmentEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
    const controllerEnvironment = { ...environment }

    if (platform === 'win32') {
        delete controllerEnvironment.RENTNERPROXY_CADDY_BIN
    }

    return controllerEnvironment
}

if (import.meta.main) {
    if (process.platform === 'win32' && process.env.RENTNERPROXY_CADDY_BIN?.trim()) {
        logger.warning(
            'Native Windows development runs without Caddy; ignoring RENTNERPROXY_CADDY_BIN. Use the Linux Docker runtime for proxy operation.',
        )
    }

    const controller = Bun.spawn({
        cmd: ['cargo', 'run', '--manifest-path', 'core/Cargo.toml'],
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: createControllerDevelopmentEnvironment(),
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    })

    process.exitCode = await controller.exited
}
