import { describe, expect, test } from 'bun:test'
import {
    browserCacheSettingsSchema,
    normalizeProxyHostHttpSettings,
    proxyConfigEditorSaveSchema,
} from '@/features/Admin/ProxyHostManagement/config-validation.ts'
import {
    createProxyHostInputSchema,
    updateProxyHostInputSchema,
} from '@/features/Admin/ProxyHostManagement/validation.ts'

const rule = { path: '/assets/app.123.js', maxAgeSeconds: 3600, immutable: true }
const browserCache = { enabled: true, rules: [rule] }

describe('scoped browser-cache settings', () => {
    test('preserves omitted defaults and explicit disabled settings', () => {
        expect(normalizeProxyHostHttpSettings({})).toEqual({})
        expect(
            normalizeProxyHostHttpSettings({ browserCache: { enabled: false, rules: [] } }),
        ).toEqual({ browserCache: { enabled: false, rules: [] } })
        expect(normalizeProxyHostHttpSettings({ browserCache })).toEqual({ browserCache })
    })
    test('accepts explicit asset files and public directory prefixes', () => {
        for (const path of [
            '/assets/',
            '/static/images/',
            '/favicon.ico',
            '/assets/app.abc.js',
            '/fonts/app.woff2',
        ]) {
            expect(
                browserCacheSettingsSchema.safeParse({ enabled: true, rules: [{ ...rule, path }] })
                    .success,
            ).toBe(true)
        }
    })
    test('rejects root, wildcards, HTML/API/auth, queries, escapes, and traversal', () => {
        for (const path of [
            '/',
            '/*',
            '/assets/*',
            '/index.html',
            '/api/',
            '/API/data.js',
            '/auth/user.js',
            '/login/',
            '/assets/a.js?x=1',
            '/assets/%2e.js',
            '/assets/../a.js',
            '/a//',
            '/a.b/',
            'assets/a.js',
            '/assets/a.js\\r\\nX: x',
        ]) {
            expect(
                browserCacheSettingsSchema.safeParse({ enabled: true, rules: [{ ...rule, path }] })
                    .success,
            ).toBe(false)
        }
    })
    test('bounds freshness and rule count, rejects duplicates and unknown fields', () => {
        for (const maxAgeSeconds of [0, -1, 1.5, 31_536_001, Infinity])
            expect(
                browserCacheSettingsSchema.safeParse({
                    enabled: true,
                    rules: [{ ...rule, maxAgeSeconds }],
                }).success,
            ).toBe(false)
        expect(browserCacheSettingsSchema.safeParse({ enabled: true, rules: [] }).success).toBe(
            false,
        )
        expect(
            browserCacheSettingsSchema.safeParse({ enabled: true, rules: [rule, rule] }).success,
        ).toBe(false)
        expect(
            browserCacheSettingsSchema.safeParse({
                enabled: true,
                rules: Array.from({ length: 21 }, (_, i) => ({
                    ...rule,
                    path: '/assets/a' + i + '.js',
                })),
            }).success,
        ).toBe(false)
        expect(
            browserCacheSettingsSchema.safeParse({ ...browserCache, blanket: true }).success,
        ).toBe(false)
    })
    test('rejects overlapping and case-duplicate scopes to keep precedence unambiguous', () => {
        for (const paths of [
            ['/assets/', '/assets/app.123.js'],
            ['/assets/', '/assets/nested/'],
            ['/assets/', '/ASSETS/'],
        ]) {
            expect(
                browserCacheSettingsSchema.safeParse({
                    enabled: true,
                    rules: paths.map((path) => Object.assign({}, rule, { path })),
                }).success,
            ).toBe(false)
        }
    })
    test('remains per-host and participates in host mutation contracts', () => {
        const host = {
            domains: ['example.test'],
            forwardScheme: 'http',
            forwardHost: '127.0.0.1',
            forwardPort: 8080,
            enabled: true,
            browserCache,
        }
        expect(createProxyHostInputSchema.parse(host).browserCache).toEqual(browserCache)
        expect(
            updateProxyHostInputSchema.parse({
                ...host,
                proxyHostId: '018f4b4a-7d1f-7abc-8def-0123456789ab',
            }).browserCache,
        ).toEqual(browserCache)
        expect(
            proxyConfigEditorSaveSchema.safeParse({
                baseRevision: 'sha256:' + 'a'.repeat(64),
                settings: { browserCache },
            }).success,
        ).toBe(false)
    })
})
