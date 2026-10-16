import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { createServer, isRunnableDevEnvironment } from 'vite'

import type { ServerFunctionResolver } from '@/tests/Types/server-functions-test.types.ts'

async function createFixtureServer(root: string) {
    return createServer({
        configFile: false,
        root,
        logLevel: 'silent',
        plugins: [tanstackStart()],
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true },
    })
}

describe('TanStack server functions after a development restart', () => {
    test('resolves a cached login function and still rejects unknown IDs', async () => {
        const parent = resolve(import.meta.dir, '../../../../tmp')
        await mkdir(parent, { recursive: true })
        const root = await mkdtemp(join(parent, 'server-function-restart-'))

        try {
            await mkdir(join(root, 'src/routes'), { recursive: true })
            await mkdir(join(root, 'src/features/Auth/Login'), { recursive: true })
            await writeFile(join(root, 'src/router.ts'), 'export const getRouter = () => ({})')
            await writeFile(
                join(root, 'src/routes/__root.tsx'),
                `import { createRootRoute } from '@tanstack/react-router'
export const Route = createRootRoute({})`,
            )
            await writeFile(
                join(root, 'src/features/Auth/Login/middleware.ts'),
                `import { createServerFn } from '@tanstack/react-start'
export const loginHandler = createServerFn({ method: 'POST' })
    .validator((data: unknown) => data)
    .handler(async () => ({ success: true }))`,
            )

            const first = await createFixtureServer(root)
            let cachedId: string
            try {
                const clientModule = await first.environments.client!.transformRequest(
                    '/src/features/Auth/Login/middleware.ts',
                )
                const match = clientModule?.code.match(/createClientRpc\("([^"]+)"\)/u)
                if (!match?.[1]) throw new Error('The login client must contain an RPC ID.')
                cachedId = match[1]
            } finally {
                await first.close()
            }

            const restarted = await createFixtureServer(root)
            try {
                const ssr = restarted.environments.ssr
                if (!ssr || !isRunnableDevEnvironment(ssr)) {
                    throw new Error('The fixture requires Vite SSR module execution.')
                }
                const resolver = await ssr.runner.import<ServerFunctionResolver>(
                    '#tanstack-start-server-fn-resolver',
                )

                const handler = await resolver.getServerFnById(cachedId, { origin: 'client' })
                expect(typeof handler).toBe('function')
                expect(handler.method).toBe('POST')

                const unknownExportId = Buffer.from(
                    JSON.stringify({
                        file: '/src/features/Auth/Login/middleware.ts?tss-serverfn-split',
                        export: 'unknownHandler_createServerFn_handler',
                    }),
                ).toString('base64url')
                await Promise.all(
                    [unknownExportId, 'not-a-server-function-id'].map((invalidId) =>
                        expect(
                            resolver.getServerFnById(invalidId, { origin: 'client' }),
                        ).rejects.toThrow('Invalid server function ID'),
                    ),
                )
            } finally {
                await restarted.close()
            }
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
})
