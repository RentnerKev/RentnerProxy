import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import yauzl from 'yauzl'

import {
    buildPortableDocument,
    buildPortablePlan,
    PortableSourceError,
    readPortableSource,
} from '@/server/Admin/Migration/portable.ts'
import {
    buildZoraxyPlan,
    readZoraxySource,
    ZoraxySourceError,
} from '@/server/Admin/Migration/zoraxy.ts'

const directories: string[] = []
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    )
})

async function fixture(name: string, data: string | Buffer): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-migration-test-'))
    directories.push(directory)
    const path = join(directory, name)
    await writeFile(path, data)
    return path
}

function crc32(bytes: Buffer): number {
    let crc = 0xffffffff
    for (const byte of bytes) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
}

type ZipFixtureEntry = {
    name: string
    value?: unknown
    data?: Buffer
    compressedData?: Buffer
    compressionMethod?: number
    flags?: number
    mode?: number
    uncompressedSize?: number
}

function zip(entries: readonly ZipFixtureEntry[], entryCount = entries.length): Buffer {
    const local: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const entry of entries) {
        const name = Buffer.from(entry.name)
        const data = entry.data ?? Buffer.from(JSON.stringify(entry.value ?? {}))
        const method = entry.compressionMethod ?? 8
        const compressed = entry.compressedData ?? (method === 0 ? data : deflateRawSync(data))
        const uncompressedSize = entry.uncompressedSize ?? data.length
        const checksum = crc32(data)
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(entry.flags ?? 0, 6)
        header.writeUInt16LE(method, 8)
        header.writeUInt32LE(checksum, 14)
        header.writeUInt32LE(compressed.length, 18)
        header.writeUInt32LE(uncompressedSize, 22)
        header.writeUInt16LE(name.length, 26)
        local.push(header, name, compressed)
        const directory = Buffer.alloc(46)
        directory.writeUInt32LE(0x02014b50, 0)
        directory.writeUInt16LE(20, 4)
        directory.writeUInt16LE(20, 6)
        directory.writeUInt16LE(entry.flags ?? 0, 8)
        directory.writeUInt16LE(method, 10)
        directory.writeUInt32LE(checksum, 16)
        directory.writeUInt32LE(compressed.length, 20)
        directory.writeUInt32LE(uncompressedSize, 24)
        directory.writeUInt16LE(name.length, 28)
        directory.writeUInt32LE(((entry.mode ?? 0) << 16) >>> 0, 38)
        directory.writeUInt32LE(offset, 42)
        central.push(directory, name)
        offset += header.length + name.length + compressed.length
    }
    const centralBytes = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entryCount, 8)
    end.writeUInt16LE(entryCount, 10)
    end.writeUInt32LE(centralBytes.length, 12)
    end.writeUInt32LE(offset, 16)
    return Buffer.concat([...local, centralBytes, end])
}

const zoraxyHost = {
    ProxyType: 1,
    RootOrMatchingDomain: 'app.example.test',
    MatchingDomainAlias: ['alias.example.test'],
    ActiveOrigins: [
        {
            OriginIpOrDomain: 'backend.internal:8080',
            RequireTLS: false,
            SkipCertValidations: false,
            SkipWebSocketOriginCheck: true,
            Weight: 1,
            MaxConn: 0,
            RespTimeout: 0,
        },
    ],
    InactiveOrigins: [],
    Disabled: false,
    AccessFilterUUID: 'default',
    TlsOptions: { DisableSNI: false, EnableAutoHTTPS: false, PreferredCertificate: {} },
    AuthenticationProvider: { AuthMethod: 0, BasicAuthCredentials: [] },
    HeaderRewriteRules: { UserDefinedHeaders: [], HSTSMaxAge: 0 },
}

describe('portable RentnerProxy configuration', () => {
    test('serializes a real host shape without credential or certificate material', async () => {
        const policyId = randomUUID()
        const hostId = randomUUID()
        const certificateId = randomUUID()
        const trustedCaId = randomUUID()
        const secret = 'DO-NOT-EXPORT-THIS-SECRET'
        const policy = {
            id: policyId,
            name: 'Protected',
            description: '',
            mode: 'authenticated' as const,
            ipRules: null,
            forwardAuth: { secret },
        }
        const document = buildPortableDocument(
            [policy],
            [
                {
                    id: hostId,
                    forwardScheme: 'http',
                    forwardHost: 'backend.internal',
                    forwardPort: 8080,
                    enabled: true,
                    forceHttps: true,
                    verifyUpstreamTls: true,
                    upstreamTlsServerName: null,
                    accessPolicyId: policyId,
                    certificateId,
                    trustedCaId,
                },
            ],
            [],
            [{ domain: 'protected.example.test', proxyHostId: hostId, redirectHostId: null }],
        )
        const serialized = JSON.stringify(document)
        expect(serialized).not.toContain(secret)
        expect(serialized).not.toContain(certificateId)
        expect(serialized).not.toContain(trustedCaId)
        const source = await readPortableSource(await fixture('export.json', serialized))
        const plan = buildPortablePlan(source, 'd'.repeat(64), new Map())
        expect(plan.items.map((item) => item.status)).toEqual(['manual', 'manual'])
        expect(document.proxyHosts[0]?.certificateRequired).toBe(true)
    })

    test('maps public and IP policies, disables certificate dependent hosts, and detects conflicts', async () => {
        const policyId = randomUUID()
        const path = await fixture(
            'source.json',
            JSON.stringify({
                format: 'rentnerproxy-portable-config',
                version: 1,
                exportedAt: new Date().toISOString(),
                policies: [
                    {
                        id: policyId,
                        name: 'Office',
                        description: '',
                        mode: 'ip-restricted',
                        ipRules: { defaultAction: 'deny', allow: ['192.0.2.0/24'], deny: [] },
                    },
                ],
                proxyHosts: [
                    {
                        id: randomUUID(),
                        domains: ['app.example.test'],
                        forwardScheme: 'http',
                        forwardHost: 'backend.internal',
                        forwardPort: 8080,
                        enabled: true,
                        forceHttps: true,
                        verifyUpstreamTls: true,
                        upstreamTlsServerName: null,
                        accessPolicyId: policyId,
                        certificateRequired: true,
                        trustedCaRequired: false,
                    },
                ],
                redirectHosts: [
                    {
                        id: randomUUID(),
                        domains: ['old.example.test'],
                        destination: 'https://new.example.test',
                        statusCode: 301,
                        preserveRequestUri: true,
                        enabled: true,
                        certificateRequired: false,
                    },
                ],
            }),
        )
        const source = await readPortableSource(path)
        const plan = buildPortablePlan(source, 'a'.repeat(64), new Map())
        expect(plan.items.map((item) => item.status)).toEqual(['ready', 'partial', 'ready'])
        expect(plan.items[1]?.proxyInput?.enabled).toBe(false)
        expect(plan.items[1]?.accessListId).toBe(1)
        const conflict = buildPortablePlan(
            source,
            'a'.repeat(64),
            new Map([['app.example.test', 'proxy-host:existing']]),
        )
        expect(conflict.items[1]?.status).toBe('conflict')
        expect(conflict.items[0]?.status).toBe('ready')
    })

    test('rejects unversioned or secret-bearing document shapes', async () => {
        const path = await fixture(
            'bad.json',
            JSON.stringify({
                format: 'rentnerproxy-portable-config',
                version: 1,
                exportedAt: new Date().toISOString(),
                policies: [],
                proxyHosts: [],
                redirectHosts: [],
                privateKey: 'should-never-be-part-of-portable-format',
            }),
        )
        await expect(readPortableSource(path)).rejects.toEqual(
            new PortableSourceError('invalid_source'),
        )
    })
})

describe('Zoraxy configuration ZIP', () => {
    test('reads stored and deflated entries in source order without reading ignored payloads', async () => {
        const path = await fixture(
            'mixed.zip',
            zip([
                { name: './conf/proxy/first.config', value: { order: 1 }, compressionMethod: 0 },
                {
                    name: 'conf/certs/ignored.key',
                    compressedData: Buffer.from([0xff]),
                    uncompressedSize: 128,
                },
                { name: 'conf/proxy/second.config', value: { order: 2 } },
                { name: 'conf/redirect/third.json', value: { order: 3 }, compressionMethod: 0 },
                { name: 'conf/streamproxy/stream.config' },
                { name: 'conf/access/policy.json' },
                { name: 'conf/rules/pathrules/rule.config' },
            ]),
        )
        const source = await readZoraxySource(path)
        expect(source.proxies).toEqual([
            { name: 'conf/proxy/first.config', value: { order: 1 } },
            { name: 'conf/proxy/second.config', value: { order: 2 } },
        ])
        expect(source.redirects).toEqual([
            { name: 'conf/redirect/third.json', value: { order: 3 } },
        ])
        expect(source.omitted).toEqual({
            streams: 1,
            accessRules: 1,
            certificates: 1,
            pathRules: 1,
        })
    })

    test.each([
        ['absolute path', { name: '/conf/proxy/app.config' }],
        ['drive path', { name: 'C:/conf/proxy/app.config' }],
        ['backslash', { name: 'conf\\proxy\\app.config' }],
        ['NUL', { name: 'conf/proxy/app\0.config' }],
        ['empty path segment', { name: 'conf//proxy/app.config' }],
        ['overlong path', { name: `conf/proxy/${'a'.repeat(500)}.config` }],
        ['symlink', { name: 'conf/proxy/app.config', mode: 0o120777 }],
        ['encryption', { name: 'conf/proxy/app.config', flags: 1 }],
        ['unsupported compression', { name: 'conf/proxy/app.config', compressionMethod: 12 }],
        ['corrupt deflate', { name: 'conf/proxy/app.config', compressedData: Buffer.from([0xff]) }],
        ['short declared size', { name: 'conf/proxy/app.config', uncompressedSize: 1 }],
        ['long declared size', { name: 'conf/proxy/app.config', uncompressedSize: 100 }],
        ['invalid JSON', { name: 'conf/proxy/app.config', data: Buffer.from('{') }],
    ] satisfies readonly (readonly [string, ZipFixtureEntry])[])(
        'rejects %s as invalid_source',
        async (_label, entry) => {
            const path = await fixture('invalid.zip', zip([entry]))
            await expect(readZoraxySource(path)).rejects.toEqual(
                new ZoraxySourceError('invalid_source'),
            )
        },
    )

    test('rejects duplicate names after normalization and case folding', async () => {
        const path = await fixture(
            'duplicate.zip',
            zip([{ name: './conf/proxy/App.config' }, { name: 'conf/proxy/app.config' }]),
        )
        await expect(readZoraxySource(path)).rejects.toEqual(
            new ZoraxySourceError('invalid_source'),
        )
    })

    test.each([[], [{ name: 'unrelated.json' }]] satisfies readonly ZipFixtureEntry[][])(
        'rejects archives without supported or omitted configuration',
        async (...entries) => {
            const path = await fixture('empty.zip', zip(entries))
            await expect(readZoraxySource(path)).rejects.toEqual(
                new ZoraxySourceError('invalid_source'),
            )
        },
    )

    test('accepts the entry and total byte boundaries without decoding ignored certificates', async () => {
        const path = await fixture(
            'entry-count-limit.zip',
            zip(
                Array.from({ length: 2_000 }, (_, index) => ({
                    name: `conf/certs/${index}.key`,
                    uncompressedSize: index === 0 ? 64 * 1024 * 1024 : 0,
                    compressedData: Buffer.from([0xff]),
                })),
            ),
        )
        expect((await readZoraxySource(path)).omitted.certificates).toBe(2_000)
    })

    test('accepts 500 selected entries and exactly 256 KiB for one entry', async () => {
        const data = Buffer.from(JSON.stringify('a'.repeat(256 * 1024 - 2)))
        const path = await fixture(
            'selected-limit.zip',
            zip(
                Array.from({ length: 500 }, (_, index) => ({
                    name: `conf/proxy/${index}.config`,
                    ...(index === 0 ? { data } : { value: index }),
                })),
            ),
        )
        const source = await readZoraxySource(path)
        expect(source.proxies).toHaveLength(500)
        expect(source.proxies[0]?.value).toBe('a'.repeat(256 * 1024 - 2))
        expect(source.proxies[499]?.value).toBe(499)
    })

    test.each([
        ['entry count', [], 2_001],
        [
            'selected count',
            Array.from({ length: 501 }, (_, index) => ({ name: `conf/proxy/${index}.config` })),
            501,
        ],
        ['entry bytes', [{ name: 'conf/proxy/app.config', uncompressedSize: 256 * 1024 + 1 }], 1],
        [
            'total bytes',
            [{ name: 'conf/certs/large.key', uncompressedSize: 64 * 1024 * 1024 + 1 }],
            1,
        ],
    ] satisfies readonly (readonly [string, ZipFixtureEntry[], number])[])(
        'rejects excessive %s as source_limit',
        async (_label, entries, entryCount) => {
            const path = await fixture('limit.zip', zip(entries, entryCount))
            await expect(readZoraxySource(path)).rejects.toEqual(
                new ZoraxySourceError('source_limit'),
            )
        },
    )

    test('closes ZIP handles after completion and early or stream rejection', async () => {
        const open = yauzl.openPromise
        const handles: yauzl.ZipFile[] = []
        const closures: Promise<void>[] = []
        const opened = spyOn(yauzl, 'openPromise').mockImplementation(async (path, options) => {
            const handle = await open(path, options)
            handles.push(handle)
            closures.push(new Promise((resolve) => handle.once('close', resolve)))
            return handle
        })
        try {
            const valid = await fixture('valid.zip', zip([{ name: 'conf/proxy/app.config' }]))
            await readZoraxySource(valid)
            const tooMany = await fixture('too-many.zip', zip([], 2_001))
            await expect(readZoraxySource(tooMany)).rejects.toEqual(
                new ZoraxySourceError('source_limit'),
            )
            const corrupt = await fixture(
                'corrupt.zip',
                zip([{ name: 'conf/proxy/app.config', compressedData: Buffer.from([0xff]) }]),
            )
            await expect(readZoraxySource(corrupt)).rejects.toEqual(
                new ZoraxySourceError('invalid_source'),
            )
            await Promise.all(closures)
            expect(handles).toHaveLength(3)
            expect(handles.every((handle) => !handle.isOpen)).toBe(true)
        } finally {
            opened.mockRestore()
        }
    })

    test('reads official file paths and safely maps simple hosts and redirects', async () => {
        const path = await fixture(
            'zoraxy.zip',
            zip([
                { name: 'conf/proxy/app.example.test.config', value: zoraxyHost },
                {
                    name: 'conf/redirect/old.json',
                    value: {
                        Enabled: true,
                        RedirectURL: 'old.example.test',
                        TargetURL: 'https://new.example.test',
                        ForwardChildpath: true,
                        StatusCode: 301,
                        RequireExactMatch: false,
                        DeviceType: 'all',
                    },
                },
                { name: 'conf/certs/ignored.key', value: { secret: 'not-read' } },
            ]),
        )
        const source = await readZoraxySource(path)
        const plan = buildZoraxyPlan(source, 'b'.repeat(64), new Map())
        expect(plan.items.map((item) => item.status)).toEqual(['partial', 'partial', 'manual'])
        expect(plan.items[0]?.proxyInput?.enabled).toBe(false)
        expect(plan.items[0]?.domains).toEqual(['app.example.test', 'alias.example.test'])
        expect(plan.items[1]?.redirectInput?.preserveRequestUri).toBe(true)
        expect(plan.items[2]?.kind).toBe('certificate')
        expect(JSON.stringify(source)).not.toContain('not-read')
    })

    test('keeps advanced authentication and path redirects manual', async () => {
        const source = {
            proxies: [
                {
                    name: 'conf/proxy/app.config',
                    value: {
                        ...zoraxyHost,
                        AuthenticationProvider: {
                            AuthMethod: 1,
                            BasicAuthCredentials: [{ Username: 'alice' }],
                        },
                    },
                },
            ],
            redirects: [
                {
                    name: 'conf/redirect/path.json',
                    value: {
                        Enabled: true,
                        RedirectURL: 'old.example.test/docs',
                        TargetURL: 'https://new.example.test',
                        ForwardChildpath: true,
                        StatusCode: 301,
                        RequireExactMatch: false,
                        DeviceType: 'all',
                    },
                },
            ],
            omitted: { streams: 0, accessRules: 0, certificates: 0, pathRules: 0 },
        }
        const plan = buildZoraxyPlan(source, 'c'.repeat(64), new Map())
        expect(plan.items.map((item) => item.status)).toEqual(['manual', 'manual'])
    })

    test('preserves an explicit TLS upstream port and defaults an omitted HTTP port', () => {
        const base = {
            name: 'conf/proxy/app.config',
            value: zoraxyHost,
        }
        const http = buildZoraxyPlan(
            {
                proxies: [
                    {
                        ...base,
                        value: {
                            ...zoraxyHost,
                            ActiveOrigins: [
                                {
                                    ...zoraxyHost.ActiveOrigins[0],
                                    OriginIpOrDomain: 'backend.internal',
                                },
                            ],
                        },
                    },
                ],
                redirects: [],
                omitted: { streams: 0, accessRules: 0, certificates: 0, pathRules: 0 },
            },
            'e'.repeat(64),
            new Map(),
        )
        expect(http.items[0]?.proxyInput?.forwardPort).toBe(80)
        const tls = buildZoraxyPlan(
            {
                proxies: [
                    {
                        ...base,
                        value: {
                            ...zoraxyHost,
                            ActiveOrigins: [
                                {
                                    ...zoraxyHost.ActiveOrigins[0],
                                    OriginIpOrDomain: 'backend.internal:80',
                                    RequireTLS: true,
                                },
                            ],
                        },
                    },
                ],
                redirects: [],
                omitted: { streams: 0, accessRules: 0, certificates: 0, pathRules: 0 },
            },
            'f'.repeat(64),
            new Map(),
        )
        expect(tls.items[0]?.proxyInput?.forwardPort).toBe(80)
        expect(tls.items[0]?.proxyInput?.forwardScheme).toBe('https')
    })

    test('rejects unsafe ZIP paths without extracting files', async () => {
        const path = await fixture(
            'traversal.zip',
            zip([
                { name: '../escape.json', value: { injected: true } },
                { name: 'conf/proxy/app.config', value: zoraxyHost },
            ]),
        )
        await expect(readZoraxySource(path)).rejects.toEqual(
            new ZoraxySourceError('invalid_source'),
        )
    })
})
