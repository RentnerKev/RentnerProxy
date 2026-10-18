import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { getMailLogoPng } from './mail-logo.ts'

export async function getMailLogoResponseService(
    request: Request,
    accent: string,
): Promise<Response> {
    if (accent.length !== 6 || !/^[0-9a-f]{6}$/iu.test(accent)) {
        return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }

    const content = await getMailLogoPng(`#${accent}`)
    const etag = `"${createHash('sha256').update(content).digest('hex')}"`
    const headers = {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        ETag: etag,
    }
    const condition = request.headers.get('if-none-match')
    const unchanged =
        condition?.trim() === '*' ||
        condition?.split(',').some((candidate) => {
            const validator = candidate.trim()
            return validator === etag || validator === `W/${etag}`
        })
    return new Response(unchanged ? null : new Uint8Array(content), {
        status: unchanged ? 304 : 200,
        headers,
    })
}
