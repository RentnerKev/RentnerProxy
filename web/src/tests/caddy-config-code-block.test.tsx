import { describe, expect, test } from 'bun:test'

import {
    formatCaddyConfig,
    tokenizeCaddyConfig,
} from '../features/Admin/ProxyHostManagement/Components/CaddyConfigCodeBlock'

describe('CaddyConfigCodeBlock', () => {
    test('pretty prints valid Caddy JSON while preserving its data', () => {
        const source = '{"http":{"servers":{"srv":{"listen":[":443"]}}}}'

        expect(formatCaddyConfig(source)).toBe(`{
  "http": {
    "servers": {
      "srv": {
        "listen": [
          ":443"
        ]
      }
    }
  }
}`)
    })

    test('keeps an unavailable source readable when it is not valid JSON', () => {
        const source = 'Caddy returned an unavailable configuration'

        expect(formatCaddyConfig(source)).toBe(source)
    })

    test('classifies JSON keys and values for semantic syntax colors', () => {
        const tokens = tokenizeCaddyConfig(
            '{ "name": "edge", "port": 443, "enabled": true, "tls": null }',
        )

        expect(tokens.filter(({ kind }) => kind === 'key').map(({ value }) => value)).toEqual([
            '"name"',
            '"port"',
            '"enabled"',
            '"tls"',
        ])
        expect(
            tokens
                .filter(({ kind }) => kind === 'string')
                .map(({ kind, value }) => ({ kind, value })),
        ).toEqual([{ kind: 'string', value: '"edge"' }])
        expect(
            tokens
                .filter(({ kind }) => kind === 'number')
                .map(({ kind, value }) => ({ kind, value })),
        ).toEqual([{ kind: 'number', value: '443' }])
        expect(
            tokens
                .filter(({ kind }) => kind === 'boolean')
                .map(({ kind, value }) => ({ kind, value })),
        ).toEqual([{ kind: 'boolean', value: 'true' }])
        expect(
            tokens
                .filter(({ kind }) => kind === 'null')
                .map(({ kind, value }) => ({ kind, value })),
        ).toEqual([{ kind: 'null', value: 'null' }])
    })
})
