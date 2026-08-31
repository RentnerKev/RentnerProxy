import { describe, expect, test } from 'bun:test'

import {
    composeProxyHostConfig,
    extractProxyHostSettings,
    HOST_SETTINGS_BEGIN,
    HOST_SETTINGS_END,
    ManagedHostConfigError,
    MAX_HOST_CONFIG_SOURCE_LENGTH,
    tokenizeNginx,
} from '../features/Admin/ProxyHostManagement/Helpers/nginxConfigSource'
import {
    ProxyHttpSettingsParseError,
    proxyHostConfigEditorIdSchema,
} from '../features/Admin/ProxyHostManagement/config-validation'

const template =
    'server {\n    listen 8080;\n    server_name demo.test;\n' +
    HOST_SETTINGS_BEGIN +
    HOST_SETTINGS_END +
    '    location / {\n        proxy_pass http://backend:4000;\n    }\n}\n'

describe('host configuration source editing', () => {
    test('fills only the marked settings and preserves the complete generated server block', () => {
        const result = composeProxyHostConfig(
            template,
            'proxy_read_timeout 120s;\nclient_max_body_size 4096k;',
        )
        expect(result).toBe(
            template.replace(
                HOST_SETTINGS_END,
                '    client_max_body_size 4m;\n    proxy_read_timeout 120s;\n' + HOST_SETTINGS_END,
            ),
        )
        expect(extractProxyHostSettings(result, template)).toBe(
            'client_max_body_size 4m;\nproxy_read_timeout 120s;',
        )
        expect(composeProxyHostConfig(template, '')).toBe(template)
        expect(extractProxyHostSettings(template, template)).toBe('')
    })

    test('rejects edits outside the settings block including other hosts and file directives', () => {
        const source = composeProxyHostConfig(template, 'proxy_read_timeout 120s;')
        const invalid = [
            source.replace('demo.test', 'other.test'),
            source.replace('http://backend:4000', 'http://other:4000'),
            source.replace('listen 8080;', 'listen 80;'),
            source.replace(HOST_SETTINGS_BEGIN, ''),
            source.replace(HOST_SETTINGS_END, ''),
            source + 'include /tmp/override.conf;\n',
            'load_module arbitrary.so;\n' + source,
            source.replace('server {', 'http {'),
        ]
        for (const input of invalid)
            expect(() => extractProxyHostSettings(input, template)).toThrow(ManagedHostConfigError)
    })

    test('rejects include, Lua, unknown directives and closing braces inside the editable region', () => {
        for (const settings of [
            'include /tmp/custom.conf;',
            'content_by_lua_block { os.execute("command") }',
            'proxy_pass http://arbitrary;',
            '}\nserver { return 200;',
            'proxy_read_timeout 30s;\nproxy_read_timeout 31s;',
            '# rentnerproxy: host HTTP settings end',
        ]) {
            const source = template.replace(
                HOST_SETTINGS_END,
                '    ' + settings + '\n' + HOST_SETTINGS_END,
            )
            expect(() => extractProxyHostSettings(source, template)).toThrow(
                ProxyHttpSettingsParseError,
            )
        }
    })

    test('rejects absent, duplicated or reversed markers and excessive source length', () => {
        for (const invalid of [
            'server {}',
            template.replace(HOST_SETTINGS_BEGIN, HOST_SETTINGS_BEGIN + HOST_SETTINGS_BEGIN),
            template + HOST_SETTINGS_END,
            HOST_SETTINGS_END + HOST_SETTINGS_BEGIN,
        ])
            expect(() => composeProxyHostConfig(invalid, '')).toThrow(ManagedHostConfigError)
        expect(() =>
            extractProxyHostSettings('x'.repeat(MAX_HOST_CONFIG_SOURCE_LENGTH + 1), null),
        ).toThrow(ManagedHostConfigError)
    })

    test('supports saved HTTP settings while the controller is offline without allowing raw config', () => {
        expect(composeProxyHostConfig(null, 'proxy_read_timeout 90s;')).toBe(
            'proxy_read_timeout 90s;',
        )
        expect(extractProxyHostSettings('client_max_body_size 1024k;', null)).toBe(
            'client_max_body_size 1m;',
        )
        expect(() => extractProxyHostSettings('include arbitrary.conf;', null)).toThrow(
            ProxyHttpSettingsParseError,
        )
    })

    test('accepts only canonicalizable UUID host identifiers', () => {
        expect(
            proxyHostConfigEditorIdSchema.parse({
                proxyHostId: '018F2F52-7C1B-7CC0-9F3C-6A9952C54019',
            }).proxyHostId,
        ).toBe('018f2f52-7c1b-7cc0-9f3c-6a9952c54019')
        for (const proxyHostId of ['../active.conf', '*', 'demo.test', '/etc/passwd', '']) {
            expect(() => proxyHostConfigEditorIdSchema.parse({ proxyHostId })).toThrow()
        }
    })
})

describe('Nginx syntax highlighting', () => {
    test('preserves every input character and identifies directives, variables, numbers, comments and strings', () => {
        const source =
            '# café\nserver {\n    proxy_read_timeout 90s;\n    proxy_set_header Host $host;\n    return 200 "<script>unsafe()</script>";\n}\n'
        const tokens = tokenizeNginx(source)
        expect(tokens.map((token) => token.text).join('')).toBe(source)
        expect(
            tokens.filter((token) => token.kind === 'directive').map((token) => token.text),
        ).toEqual(['server', 'proxy_read_timeout', 'proxy_set_header', 'return'])
        expect(tokens.find((token) => token.kind === 'comment')?.text).toBe('# café')
        expect(tokens.find((token) => token.kind === 'variable')?.text).toBe('$host')
        expect(tokens.find((token) => token.kind === 'number')?.text).toBe('90s')
        expect(tokens.find((token) => token.kind === 'string')?.text).toBe(
            '"<script>unsafe()</script>"',
        )
        for (const token of tokens)
            expect(source.slice(token.offset, token.offset + token.text.length)).toBe(token.text)
        expect(tokenizeNginx('')).toEqual([])
    })
})
