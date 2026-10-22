import '@tanstack/react-start/server-only'

import { MAX_DEFAULT_SITE_HTML_BYTES } from '@/config/default-site.config.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { defaultSiteHtmlSchema } from '@/lib/DefaultSite/defaultSite.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { DefaultSiteHtmlFormatError } from './default-site.errors.ts'

async function readFormatterStream(
    stream: ReadableStream<Uint8Array>,
    retainOutput: boolean,
): Promise<string> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
        while (true) {
            // Read sequentially so each chunk is bounded before accepting more output.
            // oxlint-disable-next-line no-await-in-loop
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > MAX_DEFAULT_SITE_HTML_BYTES) throw new DefaultSiteHtmlFormatError()
            if (retainOutput) chunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }
    if (!retainOutput) return ''
    const output = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(output)
}

export async function formatDefaultSiteHtmlService(input: unknown): Promise<string> {
    await requirePermissionService(PERMISSIONS.DEFAULT_SITE_UPDATE)
    await requirePermissionService(PERMISSIONS.PROXY_HOSTS_APPLY)
    const html = defaultSiteHtmlSchema.parse(input)
    let child: ReturnType<typeof Bun.spawn> | undefined
    try {
        const formatter = Bun.spawn(
            [
                process.execPath,
                '--no-env-file',
                'fmt',
                '--no-script',
                '--no-config',
                '--no-editorconfig',
                '--stdin-filepath=default-site.html',
                '--tab-width=4',
                '--print-width=100',
                '--html-whitespace-sensitivity=strict',
                '--threads=1',
            ],
            {
                stdin: new Blob([html]),
                stdout: 'pipe',
                stderr: 'pipe',
                timeout: 5_000,
                killSignal: 'SIGKILL',
                windowsHide: true,
            },
        )
        child = formatter
        const [output, , exitCode] = await Promise.all([
            readFormatterStream(formatter.stdout, true),
            // Parser diagnostics can include the private draft. Drain without retaining or logging.
            readFormatterStream(formatter.stderr, false),
            formatter.exited,
        ])
        if (exitCode !== 0) throw new DefaultSiteHtmlFormatError()
        return defaultSiteHtmlSchema.parse(output)
    } catch {
        child?.kill('SIGKILL')
        await child?.exited.catch(() => undefined)
        throw new DefaultSiteHtmlFormatError()
    }
}
