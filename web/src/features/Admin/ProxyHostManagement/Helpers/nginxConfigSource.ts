import { formatProxyHttpSettings, parseProxyHttpSettings } from '../config-validation'

export const MAX_HOST_CONFIG_SOURCE_LENGTH = 65_536
export const HOST_SETTINGS_BEGIN = '    # rentnerproxy: host HTTP settings begin\n'
export const HOST_SETTINGS_END = '    # rentnerproxy: host HTTP settings end\n'

export class ManagedHostConfigError extends Error {
    constructor() {
        super('Managed host configuration cannot be changed in this editor.')
    }
}

function hostTemplate(source: string) {
    const start = source.indexOf(HOST_SETTINGS_BEGIN)
    const end = source.indexOf(HOST_SETTINGS_END)
    if (
        start < 0 ||
        end < start + HOST_SETTINGS_BEGIN.length ||
        source.indexOf(HOST_SETTINGS_BEGIN, start + 1) !== -1 ||
        source.indexOf(HOST_SETTINGS_END, end + 1) !== -1
    )
        throw new ManagedHostConfigError()
    return {
        prefix: source.slice(0, start + HOST_SETTINGS_BEGIN.length),
        suffix: source.slice(end),
    }
}

export function composeProxyHostConfig(template: string | null, settingsSource: string): string {
    if (template === null) return settingsSource
    const { prefix, suffix } = hostTemplate(template)
    const normalized = formatProxyHttpSettings(parseProxyHttpSettings(settingsSource))
    return (
        prefix +
        (normalized
            ? normalized
                  .split('\n')
                  .map((line) => '    ' + line)
                  .join('\n') + '\n'
            : '') +
        suffix
    )
}

export function extractProxyHostSettings(source: string, template: string | null): string {
    if (source.length > MAX_HOST_CONFIG_SOURCE_LENGTH) throw new ManagedHostConfigError()
    if (template === null) return formatProxyHttpSettings(parseProxyHttpSettings(source))
    const { prefix, suffix } = hostTemplate(template)
    if (
        !source.startsWith(prefix) ||
        !source.endsWith(suffix) ||
        source.length < prefix.length + suffix.length
    )
        throw new ManagedHostConfigError()
    const settings = source.slice(prefix.length, source.length - suffix.length)
    return formatProxyHttpSettings(parseProxyHttpSettings(settings))
}

export type NginxTokenKind =
    | 'plain'
    | 'comment'
    | 'directive'
    | 'string'
    | 'variable'
    | 'number'
    | 'punctuation'
export interface NginxToken {
    readonly text: string
    readonly kind: NginxTokenKind
    readonly offset: number
}

const directives = new Set([
    'server',
    'listen',
    'server_name',
    'location',
    'proxy_pass',
    'proxy_http_version',
    'proxy_set_header',
    'proxy_ssl_server_name',
    'proxy_ssl_verify',
    'client_max_body_size',
    'proxy_connect_timeout',
    'proxy_read_timeout',
    'proxy_send_timeout',
    'send_timeout',
    'keepalive_timeout',
    'include',
    'http',
    'events',
    'worker_processes',
    'worker_connections',
    'pid',
    'error_log',
    'map',
    'return',
    'default_type',
    'add_header',
    'proxy_hide_header',
    'error_page',
    'root',
    'alias',
    'rewrite',
    'set',
    'if',
    'content_by_lua_block',
    'access_by_lua_block',
])

export function tokenizeNginx(source: string): NginxToken[] {
    const pattern =
        /#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$\{?[a-zA-Z_][a-zA-Z0-9_]*\}?|\b[0-9]+[a-z]*\b|[{};]|\b[a-zA-Z_][a-zA-Z0-9_]*\b/gu
    const tokens: NginxToken[] = []
    let offset = 0
    for (const match of source.matchAll(pattern)) {
        if (match.index > offset)
            tokens.push({ text: source.slice(offset, match.index), kind: 'plain', offset })
        const text = match[0]
        const kind: NginxTokenKind = text.startsWith('#')
            ? 'comment'
            : text.startsWith('"') || text.startsWith("'")
              ? 'string'
              : text.startsWith('$')
                ? 'variable'
                : /^[0-9]/u.test(text)
                  ? 'number'
                  : /^[{};]$/u.test(text)
                    ? 'punctuation'
                    : directives.has(text)
                      ? 'directive'
                      : 'plain'
        tokens.push({ text, kind, offset: match.index })
        offset = match.index + text.length
    }
    if (offset < source.length) tokens.push({ text: source.slice(offset), kind: 'plain', offset })
    return tokens
}
