import type { Plugin } from 'vite'

export function createServerFunctionWarmupPlugin(): Plugin {
    return {
        name: 'rentnerproxy-server-function-warmup',
        apply: 'serve',
        enforce: 'post',
        async configureServer(server) {
            const client = server.environments.client
            if (!client) throw new Error('Server function warmup requires the client environment.')
            const modules = await Array.fromAsync(
                new Bun.Glob('src/features/**/middleware.ts').scan({
                    cwd: server.config.root,
                    onlyFiles: true,
                }),
            )
            // Finish registration before a cached client can send its first RPC after a restart.
            await Promise.all(
                modules.map((file) => client.transformRequest(`/${file.replaceAll('\\', '/')}`)),
            )
        },
    }
}
