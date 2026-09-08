import { realpath, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

type RuntimeServer = Readonly<{
    requestIP(request: Request): { readonly address: string } | null
}>

type RuntimeFetch = (request: Request, server: RuntimeServer) => Response | Promise<Response>

function isWithinRoot(root: string, target: string): boolean {
    const path = relative(root, target)
    if (isAbsolute(path)) return false
    return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !path.startsWith(sep))
}

function notFound(): Response {
    return new Response('Not Found', {
        status: 404,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        },
    })
}

/** Serve only regular files below the immutable packaged client directory. */
export function createStaticAssetFetch(clientRoot: string, fallback: RuntimeFetch): RuntimeFetch {
    const root = realpathSync(clientRoot)

    return async (request, server) => {
        const method = request.method.toUpperCase()
        let pathname: string
        try {
            pathname = decodeURIComponent(new URL(request.url).pathname)
        } catch {
            return notFound()
        }

        const segments = pathname.split('/').slice(1)
        if (
            !pathname.startsWith('/') ||
            segments.length === 0 ||
            segments.some(
                (segment) =>
                    segment === '' ||
                    segment === '.' ||
                    segment === '..' ||
                    segment.startsWith('.'),
            )
        ) {
            return fallback(request, server)
        }

        const candidate = resolve(root, ...segments)
        if (!isWithinRoot(root, candidate)) return notFound()

        let target: string
        try {
            target = await realpath(candidate)
        } catch {
            return fallback(request, server)
        }
        if (!isWithinRoot(root, target)) return notFound()

        let fileStat
        try {
            fileStat = await stat(target)
        } catch {
            return fallback(request, server)
        }
        if (!fileStat.isFile()) return fallback(request, server)
        if (method !== 'GET' && method !== 'HEAD') {
            return new Response(null, {
                status: 405,
                headers: { Allow: 'GET, HEAD', 'X-Content-Type-Options': 'nosniff' },
            })
        }

        const file = Bun.file(target)
        const headers = new Headers({
            'Cache-Control':
                segments[0] === 'assets'
                    ? 'public, max-age=31536000, immutable'
                    : 'public, max-age=3600',
            'Content-Type': file.type || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
        })
        return new Response(method === 'HEAD' ? null : file, { headers })
    }
}
