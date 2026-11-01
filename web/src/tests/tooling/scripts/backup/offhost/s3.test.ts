// oxlint-disable no-await-in-loop -- Validation cases and fixture cleanup run in a deterministic order.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    createS3Storage,
    MAX_S3_OBJECT_BYTES,
    S3_PART_BYTES,
    validateS3Target,
} from '../../../../../../../scripts/backup/offhost/s3'
import type { OffHostS3Target } from '../../../../../../../scripts/backup/offhost/Types/s3.types'

const target: OffHostS3Target = {
    endpoint: 'https://storage.example.test',
    region: 'test-1',
    bucket: 'backups',
    prefix: 'rentner/production',
    accessKeyId: 'fixture',
    secretAccessKey: 'fixture-only',
}
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
    for (const dispose of cleanup.splice(0)) await dispose()
})

async function fixture(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
    lookupAddress = '192.168.1.20',
) {
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('fixture listen failed')
    cleanup.push(async () => {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const directory = await mkdtemp(join(tmpdir(), 'rentner-s3-'))
    cleanup.push(() => rm(directory, { force: true, recursive: true }))
    const storage = createS3Storage(target, {
        lookup: async () => [{ address: lookupAddress, family: 4 }],
        request: (options, callback) =>
            request(
                {
                    ...options,
                    protocol: 'http:',
                    hostname: '127.0.0.1',
                    port: address.port,
                    lookup: undefined,
                },
                callback,
            ),
    })
    return { storage, directory }
}

function accelerateRequestDeadline(milliseconds: number) {
    const timers = globalThis as unknown as {
        setTimeout: (...args: Parameters<typeof setTimeout>) => ReturnType<typeof setTimeout>
    }
    const originalTimeout = timers.setTimeout
    return spyOn(timers, 'setTimeout').mockImplementation((callback, duration, ...args) =>
        originalTimeout(callback, duration === 15 * 60_000 ? milliseconds : duration, ...args),
    )
}

describe('bounded scoped S3 transport', () => {
    test('a progressing GET outlives the non-GET hard deadline', async () => {
        const timer = accelerateRequestDeadline(1)
        let oldDeadlineElapsed = false
        const proofTimer = setTimeout(() => {
            oldDeadlineElapsed = true
        }, 15 * 60_000)
        try {
            const { storage, directory } = await fixture((_req, res) => {
                res.writeHead(200, { 'content-length': '20' })
                res.write('part')
                let chunks = 1
                const progress = setInterval(() => {
                    res.write('part')
                    if (++chunks === 5) {
                        clearInterval(progress)
                        res.end()
                    }
                }, 10)
                res.on('close', () => clearInterval(progress))
            })
            const output = join(directory, 'output')
            await storage.get('job', output)
            expect(await readFile(output, 'utf8')).toBe('part'.repeat(5))
            expect(oldDeadlineElapsed).toBe(true)
            expect(
                timer.mock.calls.filter(([, duration]) => duration === 15 * 60_000),
            ).toHaveLength(1)
        } finally {
            clearTimeout(proofTimer)
            timer.mockRestore()
        }
    })

    test('non-GET requests retain the hard deadline and bounded retry budget', async () => {
        const timer = accelerateRequestDeadline(10)
        try {
            const { storage } = await fixture((req) => {
                req.resume()
            })
            await expect(storage.remove('job')).rejects.toThrow('OFFHOST_S3_TIMEOUT')
            expect(
                timer.mock.calls.filter(([, duration]) => duration === 15 * 60_000),
            ).toHaveLength(3)
        } finally {
            timer.mockRestore()
        }
    })

    test('uploads bounded sequential multipart chunks and completes them', async () => {
        const sizes: number[] = []
        let completion = ''
        const { storage, directory } = await fixture((req, res) => {
            if (req.url?.includes('uploads=')) {
                req.resume()
                res.end(
                    '<InitiateMultipartUploadResult><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>',
                )
            } else if (req.method === 'PUT') {
                let bytes = 0
                req.on('data', (chunk: Buffer) => {
                    bytes += chunk.length
                })
                req.on('end', () => {
                    sizes.push(bytes)
                    res.setHeader('etag', '"fixture-etag"')
                    res.end()
                })
            } else {
                req.on('data', (chunk: Buffer) => {
                    completion += chunk.toString()
                })
                req.on('end', () => res.end('<CompleteMultipartUploadResult/>'))
            }
        })
        const source = join(directory, 'input')
        const handle = await open(source, 'wx')
        await handle.truncate(S3_PART_BYTES + 1)
        await handle.close()
        await storage.put('job', source)
        expect(sizes).toEqual([S3_PART_BYTES, 1])
        expect(completion).toContain('<PartNumber>2</PartNumber>')
        expect(completion).toContain('&quot;fixture-etag&quot;')
    })

    test('aborts a failed multipart upload using its scoped upload id', async () => {
        let removed = false
        const { storage, directory } = await fixture((req, res) => {
            req.resume()
            if (req.method === 'DELETE') {
                removed = req.url === '/backups/rentner/production/job?uploadId=fixture-upload'
                res.end()
            } else if (req.method === 'POST') res.end('<UploadId>fixture-upload</UploadId>')
            else {
                req.on('end', () => {
                    res.writeHead(403)
                    res.end('expired fixture credentials')
                })
            }
        })
        const source = join(directory, 'input')
        const handle = await open(source, 'wx')
        await handle.truncate(S3_PART_BYTES + 1)
        await handle.close()
        await expect(storage.put('job', source)).rejects.toThrow('OFFHOST_S3_AUTH')
        expect(removed).toBe(true)
    })
    test('uploads, downloads and deletes only the configured prefix', async () => {
        const operations: string[] = []
        const { storage, directory } = await fixture((req, res) => {
            operations.push(`${req.method} ${req.url}`)
            expect(req.headers.authorization).toStartWith('AWS4-HMAC-SHA256 Credential=fixture/')
            if (req.method === 'GET') res.end('encrypted-fixture')
            else {
                req.resume()
                req.on('end', () => res.end())
            }
        })
        const source = join(directory, 'input')
        await writeFile(source, 'encrypted-fixture')
        await storage.put('target/job.rpbk', source)
        await storage.get('target/job.rpbk', join(directory, 'output'))
        await storage.remove('target/job.rpbk')
        expect(await readFile(join(directory, 'output'), 'utf8')).toBe('encrypted-fixture')
        expect(operations).toEqual([
            'PUT /backups/rentner/production/target/job.rpbk',
            'GET /backups/rentner/production/target/job.rpbk',
            'DELETE /backups/rentner/production/target/job.rpbk',
        ])
    })

    test('rejects endpoint tricks before networking', async () => {
        for (const endpoint of [
            'http://storage.example',
            'https://user:pass@storage.example',
            'https://storage.example/path',
            'https://storage.example/?x=y',
            'https://storage.example/#x',
            'https://storage.example/../',
            'https://localhost',
            'https://127.0.0.1',
            'https://169.254.169.254',
            'https://[::1]',
            'https://[::]',
            'https://224.0.0.1',
            'https://[fd00:ec2::254]',
            'https://[fd20:ce::254]',
            'https://168.63.129.16',
        ]) {
            await expect(validateS3Target({ ...target, endpoint })).rejects.toThrow('OFFHOST_S3_')
        }
    })

    test('blocks unsafe DNS answers and relative key traversal', async () => {
        let requests = 0
        const { storage } = await fixture((_req, res) => {
            requests++
            res.end()
        }, '169.254.169.254')
        await expect(storage.remove('job.rpbk')).rejects.toThrow('UNSAFE_ENDPOINT')
        for (const key of [
            '../job',
            '/job',
            'job/../other',
            'job%2fother',
            'job\\other',
            'job\nother',
        ])
            await expect(storage.remove(key)).rejects.toThrow('INVALID_KEY')
        expect(requests).toBe(0)
    })

    test('never follows redirect or retries rejected credentials', async () => {
        let requests = 0
        const { storage } = await fixture((_req, res) => {
            requests++
            res.writeHead(requests === 1 ? 307 : 403, { location: 'https://secret.example/path' })
            res.end('SECRET provider details')
        })
        await expect(storage.remove('job')).rejects.toThrow('OFFHOST_S3_HTTP')
        await expect(storage.remove('job')).rejects.toThrow('OFFHOST_S3_AUTH')
        expect(requests).toBe(2)
    })

    test('retries transient responses with a finite budget', async () => {
        let requests = 0
        const { storage } = await fixture((_req, res) => {
            requests++
            res.writeHead(503)
            res.end()
        })
        await expect(storage.remove('job')).rejects.toThrow('OFFHOST_S3_HTTP')
        expect(requests).toBe(3)
    })

    test('retries a reset partial download from byte zero without holes or stale suffixes', async () => {
        let requests = 0
        const payload = 'complete-encrypted-fixture'
        const { storage, directory } = await fixture((_req, res) => {
            requests++
            if (requests === 1) {
                res.writeHead(200, { 'content-length': '1000' })
                res.write('partial-old-body-that-is-longer-than-the-replacement')
                setTimeout(() => res.destroy(), 10)
            } else res.end(payload)
        })
        const output = join(directory, 'output')
        await storage.get('job', output)
        expect(await readFile(output, 'utf8')).toBe(payload)
        expect(requests).toBe(2)
        expect(await readdir(directory)).toEqual(['output'])
    })

    test('bounds retries and cleans partial output when every response resets', async () => {
        let requests = 0
        const { storage, directory } = await fixture((_req, res) => {
            requests++
            res.writeHead(200, { 'content-length': '1000' })
            res.write('partial')
            setTimeout(() => res.destroy(), 10)
        })
        await expect(storage.get('job', join(directory, 'output'))).rejects.toThrow(
            'OFFHOST_S3_TRANSPORT',
        )
        expect(requests).toBe(3)
        expect(await readdir(directory)).toEqual([])
    })

    test('cleans partial files on oversized and truncated downloads', async () => {
        let requests = 0
        const { storage, directory } = await fixture((_req, res) => {
            requests++
            res.writeHead(200, {
                'content-length': requests === 1 ? String(MAX_S3_OBJECT_BYTES + 1) : '100',
            })
            res.write('short')
            if (requests !== 1) setTimeout(() => res.destroy(), 10)
            else res.end()
        })
        await expect(storage.get('job', join(directory, 'out'))).rejects.toThrow('OFFHOST_S3_')
        await expect(storage.get('job', join(directory, 'out'))).rejects.toThrow('OFFHOST_S3_')
        expect(await readdir(directory)).toEqual([])
    })

    test('cancels active download and upload, preserving existing output', async () => {
        const { storage, directory } = await fixture((req, res) => {
            if (req.method === 'GET') {
                res.writeHead(200, { 'content-length': '1000000' })
                res.write('partial')
            } else req.resume()
        })
        await expect(
            storage.get('job', join(directory, 'out'), AbortSignal.timeout(30)),
        ).rejects.toThrow('OFFHOST_S3_')
        const source = join(directory, 'input')
        await writeFile(source, 'encrypted')
        await expect(storage.put('job', source, AbortSignal.timeout(30))).rejects.toThrow(
            'OFFHOST_S3_',
        )
        expect((await readdir(directory)).toSorted()).toEqual(['input'])
    })

    test('does not replace a caller-owned destination', async () => {
        const { storage, directory } = await fixture((_req, res) => res.end('backup'))
        const output = join(directory, 'out')
        await writeFile(output, 'existing')
        await expect(storage.get('job', output)).rejects.toThrow('OFFHOST_S3_FILE')
        expect(await readFile(output, 'utf8')).toBe('existing')
        expect(await readdir(directory)).toEqual(['out'])
    })
})
