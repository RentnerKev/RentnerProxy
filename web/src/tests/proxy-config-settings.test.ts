import { describe, expect, test } from 'bun:test'

import {
    MAX_PROXY_ADVANCED_CONFIG_BYTES,
    MAX_PROXY_SETTINGS_SOURCE_LENGTH,
} from '../config/proxy-http.config'
import {
    formatProxyHttpSettings,
    normalizeProxyHttpSettings,
    parseProxyHttpSettings,
    proxyAdvancedConfigSchema,
    ProxyHttpSettingsParseError,
} from '../features/Admin/ProxyHostManagement/config-validation'
import {
    createProxyHostInputSchema,
    updateProxyHostInputSchema,
} from '../features/Admin/ProxyHostManagement/validation'
import { createProxyRuntimeSnapshot } from '../server/ProxyRuntime/proxy-runtime-snapshot'
import type {
    ProxyRuntimeHost,
    ProxyRuntimeSnapshot,
} from '../server/ProxyRuntime/Types/proxy-runtime.types'
import type { ProxyHttpSettings } from '../shared/Types/proxy-runtime.types'

type SnapshotInputHost = ProxyRuntimeHost & { readonly enabled: boolean }

const BASE_ID = '018f2f52-7c1b-7cc0-9f3c-6a9952c54019'
const legacyRevision = 'sha256:94a8eb29658512ed7439838b334ef5ce7e5e2e43f50b46d3e85579e49bd554b4'
const v2Revision = 'sha256:40649ed0f53ecbceb0c0c651df025f3400662c9a492e0d7baf41fe48705e47cc'

function inputHost(overrides: Partial<SnapshotInputHost> = {}): SnapshotInputHost {
    return {
        id: BASE_ID,
        domains: ['demo.test'],
        enabled: true,
        forwardScheme: 'http',
        forwardHost: 'backend.internal',
        forwardPort: 4_000,
        ...overrides,
    }
}

function legacySnapshot(): ProxyRuntimeSnapshot {
    return createProxyRuntimeSnapshot([inputHost({ domains: ['www.demo.test', 'demo.test'] })])
}

const allSettings: ProxyHttpSettings = {
    clientMaxBodySizeBytes: 10 * 1_024 * 1_024,
    proxyConnectTimeoutSeconds: 15,
    proxyReadTimeoutSeconds: 300,
    proxySendTimeoutSeconds: 300,
    sendTimeoutSeconds: 30,
    keepaliveTimeoutSeconds: 75,
}

describe('proxy HTTP settings contracts', () => {
    test('parses and formats canonical settings regardless of source ordering or byte units', () => {
        const source = [
            'keepalive_timeout 75s;',
            'proxy_send_timeout 300s;',
            'client_max_body_size 10240k;',
            'send_timeout 30s;',
            'proxy_read_timeout 300s;',
            'proxy_connect_timeout 15s;',
        ].join('\n')

        expect(parseProxyHttpSettings(source)).toEqual(allSettings)
        expect(JSON.stringify(parseProxyHttpSettings(source))).toBe(JSON.stringify(allSettings))
        expect(formatProxyHttpSettings(parseProxyHttpSettings(source))).toBe(
            [
                'client_max_body_size 10m;',
                'proxy_connect_timeout 15s;',
                'proxy_read_timeout 300s;',
                'proxy_send_timeout 300s;',
                'send_timeout 30s;',
                'keepalive_timeout 75s;',
            ].join('\n'),
        )
    })

    test('normalizes valid values into the fixed cross-language property order', () => {
        const normalized = normalizeProxyHttpSettings({
            keepaliveTimeoutSeconds: 75,
            sendTimeoutSeconds: 30,
            proxySendTimeoutSeconds: 300,
            proxyReadTimeoutSeconds: 300,
            proxyConnectTimeoutSeconds: 15,
            clientMaxBodySizeBytes: 10 * 1_024 * 1_024,
        })

        expect(normalized).toEqual(allSettings)
        expect(Object.keys(normalized)).toEqual([
            'clientMaxBodySizeBytes',
            'proxyConnectTimeoutSeconds',
            'proxyReadTimeoutSeconds',
            'proxySendTimeoutSeconds',
            'sendTimeoutSeconds',
            'keepaliveTimeoutSeconds',
        ])
    })

    test('rejects raw directives, duplicate or unknown settings, invalid units, injections, and limits', () => {
        const invalidSources = [
            'server { return 200; }',
            'lua_code_cache on;',
            'include /etc/nginx/conf.d/*.conf;',
            'load_module modules/ngx_http_lua_module.so;',
            'proxy_pass http://evil;',
            'proxy_read_timeout 30s extra;',
            'proxy_read_timeout 30s;\nproxy_pass http://evil;',
            'proxy_read_timeout 30s;\nproxy_read_timeout 31s;',
            'proxy_read_timeout 30m;',
            'client_max_body_size 16s;',
            'proxy_connect_timeout 0s;',
            'proxy_connect_timeout 61s;',
            'client_max_body_size 1023;',
            'client_max_body_size 1025m;',
            'send_timeout 301s;',
            'x'.repeat(MAX_PROXY_SETTINGS_SOURCE_LENGTH + 1),
        ]

        for (const source of invalidSources) {
            expect(() => parseProxyHttpSettings(source), source).toThrow(
                ProxyHttpSettingsParseError,
            )
        }

        expect(() => normalizeProxyHttpSettings({ unknownSetting: 1 })).toThrow()
    })

    test('reports the injected directive line while rejecting newline injection', () => {
        const source = 'proxy_read_timeout 30s;\nproxy_pass http://evil;'
        try {
            parseProxyHttpSettings(source)
            throw new Error('expected parser rejection')
        } catch (error) {
            expect(error).toBeInstanceOf(ProxyHttpSettingsParseError)
            expect((error as ProxyHttpSettingsParseError).line).toBe(2)
        }
    })
})

describe('proxy runtime configuration snapshot contract', () => {
    test('preserves the legacy version 1 snapshot and hash when settings are empty', () => {
        const withoutOptions = legacySnapshot()
        const withEmptyOptions = createProxyRuntimeSnapshot(
            [inputHost({ domains: ['www.demo.test', 'demo.test'] })],
            {},
        )

        expect(withoutOptions).toEqual({
            version: 1,
            revision: legacyRevision,
            proxyHosts: [
                {
                    id: BASE_ID,
                    domains: ['demo.test', 'www.demo.test'],
                    forwardScheme: 'http',
                    forwardHost: 'backend.internal',
                    forwardPort: 4_000,
                },
            ],
        })
        expect(withEmptyOptions).toEqual(withoutOptions)
    })

    test('uses version 2, fixed settings order, and a changed cross-language revision', () => {
        const crossLanguageHost = inputHost({
            id: '00000000-0000-0000-0000-000000000000',
            forwardHost: 'backend',
        })
        const result = createProxyRuntimeSnapshot([crossLanguageHost], allSettings)
        const equivalent = createProxyRuntimeSnapshot([crossLanguageHost], {
            keepaliveTimeoutSeconds: 75,
            sendTimeoutSeconds: 30,
            proxySendTimeoutSeconds: 300,
            proxyReadTimeoutSeconds: 300,
            proxyConnectTimeoutSeconds: 15,
            clientMaxBodySizeBytes: 10 * 1_024 * 1_024,
        })

        expect(result).toEqual({
            version: 2,
            revision: v2Revision,
            proxyHosts: [
                {
                    id: crossLanguageHost.id,
                    domains: crossLanguageHost.domains,
                    forwardScheme: crossLanguageHost.forwardScheme,
                    forwardHost: crossLanguageHost.forwardHost,
                    forwardPort: crossLanguageHost.forwardPort,
                },
            ],
            httpSettings: allSettings,
        })
        expect(result.revision).not.toBe(legacyRevision)
        expect(Object.keys(result.httpSettings ?? {})).toEqual(Object.keys(allSettings))
        expect(equivalent).toEqual(result)
    })

    test('resetting settings to an empty object restores the original revision', () => {
        const original = createProxyRuntimeSnapshot([inputHost()], {})
        const customized = createProxyRuntimeSnapshot([inputHost()], allSettings)
        const reset = createProxyRuntimeSnapshot([inputHost()], {})

        expect(customized.revision).not.toBe(original.revision)
        expect(reset.revision).toBe(original.revision)
    })
})

describe('per-host configuration snapshots', () => {
    test('uses canonical v3 with isolated host settings and matches the Rust hash vector', () => {
        const host = inputHost({
            id: '00000000-0000-0000-0000-000000000000',
            forwardHost: 'backend',
            httpSettings: { sendTimeoutSeconds: 30, proxyReadTimeoutSeconds: 300 },
        })
        const snapshot = createProxyRuntimeSnapshot([host], {
            proxyConnectTimeoutSeconds: 15,
            clientMaxBodySizeBytes: 10 * 1024 * 1024,
        })
        expect(snapshot.version).toBe(3)
        expect(snapshot.revision).toBe(
            'sha256:781f8c0b122b57b9cc2d758666ca28d30c92b2bbbfe6414f980b92aaecdb430c',
        )
        expect(Object.keys(snapshot.proxyHosts[0]!.httpSettings!)).toEqual([
            'proxyReadTimeoutSeconds',
            'sendTimeoutSeconds',
        ])
        expect(snapshot.httpSettings).toEqual({
            clientMaxBodySizeBytes: 10 * 1024 * 1024,
            proxyConnectTimeoutSeconds: 15,
        })
        expect(snapshot.proxyHosts[0]!.httpSettings).not.toHaveProperty('clientMaxBodySizeBytes')
    })

    test('empty overrides preserve v1 and v2 while host-only settings use v3 with empty shared defaults', () => {
        const plain = inputHost()
        const empty = inputHost({ httpSettings: {} })
        expect(createProxyRuntimeSnapshot([empty])).toEqual(createProxyRuntimeSnapshot([plain]))
        expect(createProxyRuntimeSnapshot([empty], allSettings)).toEqual(
            createProxyRuntimeSnapshot([plain], allSettings),
        )
        const hostOnly = createProxyRuntimeSnapshot([
            inputHost({ httpSettings: { sendTimeoutSeconds: 30 } }),
        ])
        expect(hostOnly.version).toBe(3)
        expect(hostOnly.httpSettings).toEqual({})
    })

    test('resetting one host preserves the other host settings and all shared defaults', () => {
        const first = inputHost({ httpSettings: { proxyReadTimeoutSeconds: 90 } })
        const second = inputHost({
            id: '018f2f52-7c1b-7cc0-9f3c-6a9952c54020',
            domains: ['second.test'],
            httpSettings: { proxyReadTimeoutSeconds: 180 },
        })
        const original = createProxyRuntimeSnapshot([second, first], allSettings)
        const reset = createProxyRuntimeSnapshot([inputHost(), second], allSettings)
        expect(reset.revision).not.toBe(original.revision)
        expect(reset.proxyHosts[0]).not.toHaveProperty('httpSettings')
        expect(reset.proxyHosts[1]).toEqual(original.proxyHosts[1])
        expect(reset.httpSettings).toEqual(allSettings)
        expect(reset.version).toBe(3)
    })

    test('disabled host overrides do not alter the active snapshot and return on reenable', () => {
        const custom = inputHost({ httpSettings: { proxyReadTimeoutSeconds: 90 } })
        const disabled = createProxyRuntimeSnapshot([{ ...custom, enabled: false }], allSettings)
        expect(disabled).toEqual(createProxyRuntimeSnapshot([], allSettings))
        expect(createProxyRuntimeSnapshot([{ ...custom, enabled: true }], allSettings)).toEqual(
            createProxyRuntimeSnapshot([custom], allSettings),
        )
    })

    test('validates host settings as strictly as the shared defaults', () => {
        expect(() =>
            createProxyRuntimeSnapshot([
                inputHost({ httpSettings: { proxyReadTimeoutSeconds: 3601 } }),
            ]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([
                inputHost({ httpSettings: { proxyConnectTimeoutSeconds: 0 } }),
            ]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([
                inputHost({
                    httpSettings: {
                        unexpected: 'include /tmp/evil;',
                    } as unknown as ProxyHttpSettings,
                }),
            ]),
        ).toThrow()
    })
})

describe('free expert proxy configuration', () => {
    test('preserves empty legacy snapshots and accepts arbitrary multiline directive text', () => {
        const empty = inputHost({ advancedConfig: '' })
        expect(proxyAdvancedConfigSchema.parse('')).toBe('')
        expect(createProxyRuntimeSnapshot([empty])).toEqual(
            createProxyRuntimeSnapshot([inputHost()]),
        )
        expect(createProxyRuntimeSnapshot([empty], allSettings)).toEqual(
            createProxyRuntimeSnapshot([inputHost()], allSettings),
        )
        const source = [
            '  # comment with spaces  ',
            'client_max_body_size 2g;',
            'add_header X-Test "hello" always;',
            'location = /advanced-test {',
            '    return 200 "advanced-ok";',
            '}',
            'include /etc/nginx/custom/*.conf;',
            'if ($request_method = POST) { return 405; }',
            "content_by_lua_block { ngx.say('ok') }",
            '',
        ].join('\n')
        expect(proxyAdvancedConfigSchema.parse(source)).toBe(source)
        expect(
            createProxyRuntimeSnapshot([inputHost({ advancedConfig: source })]).proxyHosts[0]
                ?.advancedConfig,
        ).toBe(source)
    })

    test('normalizes only CRLF and preserves whitespace, quotes, comments and a bare CR', () => {
        const source = ' \r\n# custom\r\nadd_header X-Test "quoted value";\r\n\r tail '
        const normalized = ' \n# custom\nadd_header X-Test "quoted value";\n\r tail '
        expect(proxyAdvancedConfigSchema.parse(source)).toBe(normalized)
        expect(createProxyRuntimeSnapshot([inputHost({ advancedConfig: source })])).toEqual(
            createProxyRuntimeSnapshot([inputHost({ advancedConfig: normalized })]),
        )
    })

    test('enforces UTF-8 byte limits without truncating accepted text', () => {
        for (const maximum of [
            'x'.repeat(MAX_PROXY_ADVANCED_CONFIG_BYTES),
            'é'.repeat(MAX_PROXY_ADVANCED_CONFIG_BYTES / 2),
            '😀'.repeat(MAX_PROXY_ADVANCED_CONFIG_BYTES / 4),
        ]) {
            expect(proxyAdvancedConfigSchema.parse(maximum)).toBe(maximum)
            expect(proxyAdvancedConfigSchema.safeParse(maximum + 'x').success).toBeFalse()
            expect(() =>
                createProxyRuntimeSnapshot([inputHost({ advancedConfig: maximum + 'x' })]),
            ).toThrow()
        }
    })

    test('rejects NUL, invalid Unicode and non-string transport values', () => {
        for (const invalid of [null, 42, {}, [], true, 'valid\0text', '\uD800', '\uDC00']) {
            expect(proxyAdvancedConfigSchema.safeParse(invalid).success).toBeFalse()
        }
        expect(() =>
            createProxyRuntimeSnapshot([inputHost({ advancedConfig: 'bad\0text' })]),
        ).toThrow()
        expect(() =>
            createProxyRuntimeSnapshot([inputHost({ advancedConfig: '\uD800' })]),
        ).toThrow()
    })

    test('includes expert text after typed settings in the shared Rust hash contract', () => {
        const advancedConfig =
            '# expert config\nadd_header X-Test "hello" always;\nlocation = /advanced-test {\n    return 200 "advanced-ok";\n}\n'
        const host = inputHost({
            id: '00000000-0000-0000-0000-000000000000',
            forwardHost: 'backend',
            httpSettings: { sendTimeoutSeconds: 30, proxyReadTimeoutSeconds: 300 },
            advancedConfig,
        })
        const result = createProxyRuntimeSnapshot([host], {
            proxyConnectTimeoutSeconds: 15,
            clientMaxBodySizeBytes: 10 * 1024 * 1024,
        })
        expect(result.version).toBe(3)
        expect(result.revision).toBe(
            'sha256:07a13b9537067ccfc5d31342cb5e58f05defad63948733269767ee02bd062199',
        )
        expect(Object.keys(result.proxyHosts[0]!)).toEqual([
            'id',
            'domains',
            'forwardScheme',
            'forwardHost',
            'forwardPort',
            'httpSettings',
            'advancedConfig',
        ])
        expect(result.proxyHosts[0]?.advancedConfig).toBe(advancedConfig)
    })

    test('changes revision with expert text but not equivalent line endings', () => {
        const source = 'add_header X-Test "one" always;\n'
        const plain = createProxyRuntimeSnapshot([inputHost()])
        const original = createProxyRuntimeSnapshot([inputHost({ advancedConfig: source })])
        expect(original.version).toBe(3)
        expect(original.httpSettings).toEqual({})
        expect(original.revision).not.toBe(plain.revision)
        expect(createProxyRuntimeSnapshot([inputHost({ advancedConfig: source })])).toEqual(
            original,
        )
        expect(
            createProxyRuntimeSnapshot([
                inputHost({ advancedConfig: source.replaceAll('\n', '\r\n') }),
            ]),
        ).toEqual(original)
        expect(
            createProxyRuntimeSnapshot([
                inputHost({ advancedConfig: source.replace('one', 'two') }),
            ]).revision,
        ).not.toBe(original.revision)
        expect(
            createProxyRuntimeSnapshot([inputHost({ advancedConfig: source + ' ' })]).revision,
        ).not.toBe(original.revision)
        expect(createProxyRuntimeSnapshot([inputHost({ advancedConfig: '' })])).toEqual(plain)
    })

    test('omits disabled expert hosts and restores exactly their revision on enable', () => {
        const host = inputHost({ advancedConfig: 'location = /test { return 200 "ok"; }' })
        expect(createProxyRuntimeSnapshot([{ ...host, enabled: false }])).toEqual(
            createProxyRuntimeSnapshot([]),
        )
        expect(createProxyRuntimeSnapshot([{ ...host, enabled: true }])).toEqual(
            createProxyRuntimeSnapshot([host]),
        )
    })

    test('keeps raw config out of the ordinary create and update input contract', () => {
        const input = {
            domains: ['demo.test'],
            enabled: true,
            forwardScheme: 'http',
            forwardHost: 'backend',
            forwardPort: 4000,
            advancedConfig: 'unexpected_directive;',
        }
        expect(createProxyHostInputSchema.parse(input)).not.toHaveProperty('advancedConfig')
        expect(
            updateProxyHostInputSchema.parse({ ...input, proxyHostId: BASE_ID }),
        ).not.toHaveProperty('advancedConfig')
    })
})
