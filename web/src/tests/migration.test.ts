import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { afterEach, describe, expect, test } from 'bun:test'

import {
    buildPortableDocument,
    buildPortablePlan,
    PortableSourceError,
    readPortableSource,
} from '../server/Admin/Migration/portable'
import {
    buildZoraxyPlan,
    readZoraxySource,
    ZoraxySourceError,
} from '../server/Admin/Migration/zoraxy'

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

function zip(entries: readonly { name: string; value: unknown }[]): Buffer {
    const local: Buffer[] = []
    const central: Buffer[] = []
    let offset = 0
    for (const entry of entries) {
        const name = Buffer.from(entry.name)
        const data = Buffer.from(JSON.stringify(entry.value))
        const compressed = deflateRawSync(data)
        const checksum = crc32(data)
        const header = Buffer.alloc(30)
        header.writeUInt32LE(0x04034b50, 0)
        header.writeUInt16LE(20, 4)
        header.writeUInt16LE(8, 8)
        header.writeUInt32LE(checksum, 14)
        header.writeUInt32LE(compressed.length, 18)
        header.writeUInt32LE(data.length, 22)
        header.writeUInt16LE(name.length, 26)
        local.push(header, name, compressed)
        const directory = Buffer.alloc(46)
        directory.writeUInt32LE(0x02014b50, 0)
        directory.writeUInt16LE(20, 4)
        directory.writeUInt16LE(20, 6)
        directory.writeUInt16LE(8, 10)
        directory.writeUInt32LE(checksum, 16)
        directory.writeUInt32LE(compressed.length, 20)
        directory.writeUInt32LE(data.length, 24)
        directory.writeUInt16LE(name.length, 28)
        directory.writeUInt32LE(offset, 42)
        central.push(directory, name)
        offset += header.length + name.length + compressed.length
    }
    const centralBytes = Buffer.concat(central)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
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
