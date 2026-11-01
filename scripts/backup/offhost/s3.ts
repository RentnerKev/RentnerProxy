// oxlint-disable no-await-in-loop -- Sequential bounded transfers and retries limit memory and concurrency.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { constants } from 'node:fs'
import { link, open, rm } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { readFileRange } from '../artifact-file'
import type { OffHostS3Target, S3Dependencies } from './Types/s3.types'

export type { OffHostS3Target } from './Types/s3.types'
export const MAX_S3_OBJECT_BYTES = 32 * 1024 ** 3
export const S3_PART_BYTES = 64 * 1024 ** 2
const RESPONSE_LIMIT = 1024 * 1024

class StorageError extends Error {
    constructor(
        code: string,
        readonly retryable = false,
    ) {
        super(`OFFHOST_S3_${code}`)
    }
}

function transferError(error: unknown): StorageError {
    if (error instanceof StorageError) return error
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    return new StorageError(
        'TRANSPORT',
        [
            'ECONNRESET',
            'ETIMEDOUT',
            'EPIPE',
            'ECONNREFUSED',
            'EAI_AGAIN',
            'ERR_STREAM_PREMATURE_CLOSE',
        ].includes(code),
    )
}

function validPath(value: string): boolean {
    return (
        value.length > 0 &&
        value.length <= 768 &&
        value
            .split('/')
            .every(
                (part) =>
                    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part !== '.' && part !== '..',
            )
    )
}

function safeAddress(address: string): boolean {
    if (address === '168.63.129.16') return false
    if (isIP(address) === 4) {
        const [first, second] = address.split('.').map(Number)
        return (
            first !== 0 &&
            first !== 127 &&
            first !== 169 &&
            first! < 224 &&
            !(first === 100 && second === 100)
        )
    }
    if (isIP(address) === 6) {
        const value = new URL(`https://[${address}]`).hostname.slice(1, -1).toLowerCase()
        if (value === 'fd00:ec2::254' || value === 'fd20:ce::254') return false
        // IPv4-mapped and transition addresses are rejected rather than interpreted inconsistently.
        return (
            !value.includes('.') &&
            !value.startsWith('::') &&
            !/^fe[89ab]/.test(value) &&
            !value.startsWith('ff') &&
            !value.startsWith('2001:0:') &&
            !value.startsWith('64:ff9b:')
        )
    }
    return false
}

function parseTarget(input: OffHostS3Target): OffHostS3Target {
    try {
        const endpoint = new URL(input.endpoint)
        if (
            !/^https:\/\/[^/?#\\\s]+\/?$/.test(input.endpoint) ||
            endpoint.protocol !== 'https:' ||
            endpoint.username ||
            endpoint.password ||
            endpoint.pathname !== '/' ||
            endpoint.search ||
            endpoint.hash ||
            endpoint.hostname.endsWith('.') ||
            /(^|\.)(localhost|metadata)(\.|$)/i.test(endpoint.hostname)
        )
            throw new Error()
        if (
            !/^[a-zA-Z0-9-]{1,64}$/.test(input.region) ||
            !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket) ||
            input.bucket.includes('..') ||
            isIP(input.bucket) ||
            !validPath(input.prefix) ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(input.accessKeyId) ||
            !/^[\x21-\x7e]{1,256}$/.test(input.secretAccessKey)
        )
            throw new Error()
        return { ...input, endpoint: endpoint.origin }
    } catch {
        throw new StorageError('INVALID_TARGET')
    }
}

async function resolveTarget(
    target: OffHostS3Target,
    dependencies: S3Dependencies,
    signal?: AbortSignal,
) {
    const hostname = new URL(target.endpoint).hostname.replace(/^\[|\]$/g, '')
    let addresses
    try {
        const abort = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])])
        addresses = isIP(hostname)
            ? [{ address: hostname, family: isIP(hostname) }]
            : await new Promise<Awaited<ReturnType<NonNullable<S3Dependencies['lookup']>>>>(
                  (resolve, reject) => {
                      const interrupted = () => reject(new StorageError('DNS'))
                      abort.addEventListener('abort', interrupted, { once: true })
                      if (abort.aborted) interrupted()
                      void (dependencies.lookup ?? ((host) => lookup(host, { all: true })))(
                          hostname,
                      )
                          .then(resolve, reject)
                          .finally(() => abort.removeEventListener('abort', interrupted))
                  },
              )
    } catch {
        throw new StorageError('DNS')
    }
    if (!addresses.length || addresses.some(({ address }) => !safeAddress(address)))
        throw new StorageError('UNSAFE_ENDPOINT')
    return addresses[0]!
}

export async function validateS3Target(input: OffHostS3Target): Promise<OffHostS3Target> {
    const target = parseTarget(input)
    await resolveTarget(target, {})
    return target
}

function digest(bytes: Uint8Array | string) {
    return createHash('sha256').update(bytes).digest('hex')
}
function hmac(key: Uint8Array | string, data: string) {
    return createHmac('sha256', key).update(data).digest()
}
function encode(value: string) {
    return encodeURIComponent(value).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
}

async function smallResponse(response: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of response) {
        const data = Buffer.from(chunk)
        bytes += data.length
        if (bytes > RESPONSE_LIMIT) throw new StorageError('RESPONSE_LIMIT')
        chunks.push(data)
    }
    if (!response.complete) throw new StorageError('TRUNCATED')
    return Buffer.concat(chunks)
}

function operationSignal(signal?: AbortSignal) {
    return AbortSignal.any([AbortSignal.timeout(2 * 60 * 60_000), ...(signal ? [signal] : [])])
}

export function createS3Storage(input: OffHostS3Target, dependencies: S3Dependencies = {}) {
    const target = parseTarget(input)
    const endpoint = new URL(target.endpoint)
    function scopedPath(key: string) {
        if (!validPath(key) || `${target.prefix}/${key}`.length > 1024)
            throw new StorageError('INVALID_KEY')
        return `/${target.bucket}/${target.prefix}/${key}`.split('/').map(encode).join('/')
    }

    async function call<T>(
        method: string,
        path: string,
        query: Record<string, string>,
        body: Buffer,
        signal: AbortSignal,
        consume: (response: IncomingMessage) => Promise<T>,
    ): Promise<T> {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (signal.aborted) throw new StorageError('ABORTED')
            try {
                const address = await resolveTarget(target, dependencies, signal)
                signal.throwIfAborted()
                const canonicalQuery = Object.entries(query)
                    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
                    .join('&')
                const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
                const date = timestamp.slice(0, 8)
                const payload = digest(body)
                const headers = {
                    host: endpoint.host,
                    'x-amz-content-sha256': payload,
                    'x-amz-date': timestamp,
                }
                const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
                const canonical = [
                    method,
                    path,
                    canonicalQuery,
                    `host:${endpoint.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${timestamp}\n`,
                    signedHeaders,
                    payload,
                ].join('\n')
                const scope = `${date}/${target.region}/s3/aws4_request`
                const signingKey = hmac(
                    hmac(hmac(hmac(`AWS4${target.secretAccessKey}`, date), target.region), 's3'),
                    'aws4_request',
                )
                const signature = hmac(
                    signingKey,
                    `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${digest(canonical)}`,
                ).toString('hex')
                return await new Promise<T>((resolve, reject) => {
                    let response: IncomingMessage | undefined
                    const req = (dependencies.request ?? request)(
                        {
                            protocol: 'https:',
                            hostname: endpoint.hostname.replace(/^\[|\]$/g, ''),
                            port: endpoint.port || 443,
                            method,
                            path: path + (canonicalQuery ? `?${canonicalQuery}` : ''),
                            agent: false,
                            family: address.family,
                            signal,
                            lookup: (_host, _options, callback) =>
                                callback(null, address.address, address.family),
                            headers: {
                                ...headers,
                                authorization: `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
                                'content-length': body.length,
                            },
                        },
                        (incoming) => {
                            response = incoming
                            const status = incoming.statusCode ?? 0
                            if (status < 200 || status >= 300) {
                                incoming.destroy()
                                reject(
                                    new StorageError(
                                        status === 401 || status === 403 ? 'AUTH' : 'HTTP',
                                        [408, 429, 500, 502, 503, 504].includes(status),
                                    ),
                                )
                                return
                            }
                            void consume(incoming)
                                .then(resolve, (error: unknown) => reject(transferError(error)))
                                .finally(() => incoming.destroy())
                        },
                    )
                    const timer = setTimeout(
                        () => req.destroy(new StorageError('TIMEOUT', true)),
                        15 * 60_000,
                    )
                    req.setTimeout(60_000, () => req.destroy(new StorageError('TIMEOUT', true)))
                    req.on('error', (error: NodeJS.ErrnoException) => {
                        const failure = transferError(error)
                        // Let the consumer finish pending file writes before a retry starts.
                        if (response) response.destroy(failure)
                        else reject(failure)
                    })
                    req.on('close', () => {
                        clearTimeout(timer)
                        if (signal.aborted) response?.destroy()
                    })
                    req.end(body)
                })
            } catch (error) {
                if (signal.aborted) throw new StorageError('ABORTED')
                if (!(error instanceof StorageError) || !error.retryable || attempt === 2)
                    throw error instanceof StorageError ? error : new StorageError('TRANSFER')
                try {
                    await delay(100 * 2 ** attempt, undefined, { signal })
                } catch {
                    throw new StorageError('ABORTED')
                }
            }
        }
        throw new StorageError('TRANSFER')
    }

    return {
        async put(key: string, file: string, signal?: AbortSignal): Promise<void> {
            const path = scopedPath(key)
            const abort = operationSignal(signal)
            const inputFile = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
                () => {
                    throw new StorageError('FILE')
                },
            )
            let uploadId: string | undefined
            try {
                const info = await inputFile.stat()
                if (!info.isFile() || info.size > MAX_S3_OBJECT_BYTES)
                    throw new StorageError('FILE_LIMIT')
                if (info.size <= S3_PART_BYTES) {
                    abort.throwIfAborted()
                    await call(
                        'PUT',
                        path,
                        {},
                        await readFileRange(inputFile, 0, info.size),
                        abort,
                        smallResponse,
                    )
                } else {
                    const initiated = await call(
                        'POST',
                        path,
                        { uploads: '' },
                        Buffer.alloc(0),
                        abort,
                        smallResponse,
                    )
                    uploadId = /<UploadId>([^<]{1,2048})<\/UploadId>/.exec(
                        initiated.toString(),
                    )?.[1]
                    if (!uploadId || !/^[A-Za-z0-9_+/=.~%-]+$/.test(uploadId))
                        throw new StorageError('MULTIPART')
                    const parts: string[] = []
                    for (
                        let offset = 0, part = 1;
                        offset < info.size;
                        offset += S3_PART_BYTES, part++
                    ) {
                        abort.throwIfAborted()
                        const bytes = await readFileRange(
                            inputFile,
                            offset,
                            Math.min(S3_PART_BYTES, info.size - offset),
                        )
                        const etag = await call(
                            'PUT',
                            path,
                            { partNumber: String(part), uploadId },
                            bytes,
                            abort,
                            async (response) => {
                                await smallResponse(response)
                                const value = response.headers.etag
                                if (!value || !/^"?[A-Za-z0-9-]{1,128}"?$/.test(value))
                                    throw new StorageError('MULTIPART')
                                return value.replaceAll('"', '&quot;')
                            },
                        )
                        parts.push(
                            `<Part><PartNumber>${part}</PartNumber><ETag>${etag}</ETag></Part>`,
                        )
                    }
                    const completed = await call(
                        'POST',
                        path,
                        { uploadId },
                        Buffer.from(
                            `<CompleteMultipartUpload>${parts.join('')}</CompleteMultipartUpload>`,
                        ),
                        abort,
                        smallResponse,
                    )
                    if (
                        !completed.toString().includes('<CompleteMultipartUploadResult') ||
                        completed.toString().includes('<Error>')
                    )
                        throw new StorageError('MULTIPART')
                    uploadId = undefined
                }
                if ((await inputFile.stat()).size !== info.size)
                    throw new StorageError('FILE_CHANGED')
            } catch (error) {
                if (uploadId)
                    await call(
                        'DELETE',
                        path,
                        { uploadId },
                        Buffer.alloc(0),
                        AbortSignal.timeout(30_000),
                        smallResponse,
                    ).catch(() => {})
                throw error instanceof StorageError
                    ? error
                    : new StorageError(abort.aborted ? 'ABORTED' : 'FILE')
            } finally {
                await inputFile.close()
            }
        },
        async get(key: string, outputFile: string, signal?: AbortSignal): Promise<void> {
            const path = scopedPath(key)
            const abort = operationSignal(signal)
            const temporary = `${outputFile}.${randomUUID()}.partial`
            const output = await open(temporary, 'wx', 0o600).catch(() => {
                throw new StorageError('FILE')
            })
            try {
                await call('GET', path, {}, Buffer.alloc(0), abort, async (response) => {
                    await output.truncate(0)
                    const length = response.headers['content-length']
                    if (!length || !/^\d+$/.test(length) || Number(length) > MAX_S3_OBJECT_BYTES)
                        throw new StorageError('FILE_LIMIT')
                    let bytes = 0
                    for await (const chunk of response) {
                        abort.throwIfAborted()
                        const data = Buffer.from(chunk)
                        bytes += data.length
                        if (bytes > Number(length) || bytes > MAX_S3_OBJECT_BYTES)
                            throw new StorageError('FILE_LIMIT')
                        let written = 0
                        while (written < data.length) {
                            const result = await output.write(
                                data,
                                written,
                                data.length - written,
                                bytes - data.length + written,
                            )
                            if (!result.bytesWritten) throw new StorageError('FILE')
                            written += result.bytesWritten
                        }
                    }
                    if (!response.complete || bytes !== Number(length))
                        throw new StorageError('TRUNCATED')
                })
                await output.sync()
                await output.close()
                // Atomic, exclusive publication: never replace an existing caller-owned file.
                await link(temporary, outputFile)
            } catch (error) {
                throw error instanceof StorageError
                    ? error
                    : new StorageError(abort.aborted ? 'ABORTED' : 'FILE')
            } finally {
                await output.close().catch(() => {})
                await rm(temporary, { force: true })
            }
        },
        async remove(key: string, signal?: AbortSignal): Promise<void> {
            await call(
                'DELETE',
                scopedPath(key),
                {},
                Buffer.alloc(0),
                operationSignal(signal),
                smallResponse,
            )
        },
    }
}
