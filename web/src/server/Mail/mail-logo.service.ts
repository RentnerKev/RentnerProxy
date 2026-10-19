import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { MAIL_LOGO_RENDER_RATE_LIMITS } from '@/config/mail.config.ts'
import {
    consumeRateLimit,
    getClientIp,
    RateLimitError,
    RateLimitUnavailableError,
} from '@/server/Valkey/rate-limiter.service.ts'
import type { RateLimitDependencies } from '@/server/Valkey/Types/rate-limiter.types.ts'
import { getMailLogoPng, MailLogoBusyError } from './mail-logo.ts'

export async function getMailLogoResponseService(
    request: Request,
    accent: string,
    dependencies: Partial<RateLimitDependencies> = {},
): Promise<Response> {
    if (accent.length !== 6 || !/^[0-9a-f]{6}$/iu.test(accent)) {
        return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }

    let content: Buffer
    try {
        content = await getMailLogoPng(`#${accent}`, async () => {
            // Reuse trusted client identification, including its conservative unknown
            // bucket. Never use caller-supplied forwarding headers to mint new buckets.
            await consumeRateLimit(
                { ...MAIL_LOGO_RENDER_RATE_LIMITS.client, identifier: getClientIp(request) },
                dependencies,
            )
            await consumeRateLimit(
                { ...MAIL_LOGO_RENDER_RATE_LIMITS.global, identifier: 'all' },
                dependencies,
            )
        })
    } catch (error) {
        const limited = error instanceof RateLimitError
        if (
            !limited &&
            !(error instanceof RateLimitUnavailableError) &&
            !(error instanceof MailLogoBusyError)
        )
            throw error
        return new Response(null, {
            status: limited ? 429 : 503,
            headers: {
                'Cache-Control': 'no-store',
                'Retry-After': String(
                    limited
                        ? Math.max(1, Math.ceil(error.retryAfterMs / 1000))
                        : error instanceof MailLogoBusyError
                          ? 1
                          : 60,
                ),
            },
        })
    }
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
