import type { CaddyConfigToken, CaddyConfigTokenKind } from './Types/caddy-config.types.ts'

export function formatCaddyConfig(source: string): string {
    try {
        const parsed: unknown = JSON.parse(source)
        return JSON.stringify(parsed, null, 2) ?? source
    } catch {
        return source
    }
}

function readJsonString(source: string, start: number): number {
    let escaped = false
    for (let index = start + 1; index < source.length; index += 1) {
        const character = source[index]
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') return index + 1
    }
    return source.length
}

function readWhile(source: string, start: number, predicate: (character: string) => boolean) {
    let index = start
    while (index < source.length && predicate(source[index] ?? '')) index += 1
    return index
}

function readJsonNumber(source: string, start: number): number {
    let index = start
    if (source[index] === '-') index += 1
    if (source[index] === '0') index += 1
    else index = readWhile(source, index, (value) => /\d/u.test(value))
    if (source[index] === '.') {
        index = readWhile(source, index + 1, (value) => /\d/u.test(value))
    }
    if (source[index] === 'e' || source[index] === 'E') {
        index += 1
        if (source[index] === '+' || source[index] === '-') index += 1
        index = readWhile(source, index, (value) => /\d/u.test(value))
    }
    return index
}

function readJsonLiteral(
    source: string,
    start: number,
): { readonly kind: 'boolean' | 'null'; readonly end: number } | null {
    for (const [literal, kind] of [
        ['true', 'boolean'],
        ['false', 'boolean'],
        ['null', 'null'],
    ] as const) {
        const end = start + literal.length
        if (source.slice(start, end) !== literal) continue
        const next = source[end]
        if (next === undefined || /\s/u.test(next) || '{}[],:'.includes(next)) return { kind, end }
    }
    return null
}

export function tokenizeCaddyConfig(source: string): CaddyConfigToken[] {
    const tokens: CaddyConfigToken[] = []
    const pushToken = (kind: CaddyConfigTokenKind, start: number, value: string) => {
        tokens.push({ kind, start, value })
    }
    let index = 0
    while (index < source.length) {
        const character = source[index] ?? ''
        if (/\s/u.test(character)) {
            const end = readWhile(source, index, (value) => /\s/u.test(value))
            pushToken('plain', index, source.slice(index, end))
            index = end
            continue
        }
        if (character === '"') {
            const end = readJsonString(source, index)
            const nextToken = readWhile(source, end, (value) => /\s/u.test(value))
            pushToken(source[nextToken] === ':' ? 'key' : 'string', index, source.slice(index, end))
            index = end
            continue
        }
        if ('{}[],:'.includes(character)) {
            pushToken('punctuation', index, character)
            index += 1
            continue
        }
        if (character === '-' || /\d/u.test(character)) {
            const end = readJsonNumber(source, index)
            if (end > index) {
                pushToken('number', index, source.slice(index, end))
                index = end
                continue
            }
        }
        const literal = readJsonLiteral(source, index)
        if (literal) {
            pushToken(literal.kind, index, source.slice(index, literal.end))
            index = literal.end
            continue
        }
        const end = readWhile(
            source,
            index,
            (value) => !/\s/u.test(value) && !'{}[],:'.includes(value),
        )
        pushToken('plain', index, source.slice(index, end || index + 1))
        index = end || index + 1
    }
    return tokens
}
