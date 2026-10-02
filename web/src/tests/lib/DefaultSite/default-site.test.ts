import { describe, expect, test } from 'bun:test'

import { MAX_DEFAULT_SITE_HTML_BYTES } from '@/config/default-site.config.ts'
import { PERMISSIONS, PERMISSION_REGISTRY, SYSTEM_ROLES } from '@/config/permissions.config.ts'
import { SYSTEM_ROLE_REGISTRY } from '@/lib/Permissions/systemRoles.ts'
import { defaultSiteSaveSchema, defaultSiteSettingsSchema } from '@/lib/DefaultSite/defaultSite.ts'
import { createProxyRuntimeSnapshot } from '@/server/ProxyRuntime/proxy-runtime-snapshot.ts'
import { parseStoredDefaultSiteSettings } from '@/server/DefaultSite/default-site-settings.ts'

describe('default site settings', () => {
    test('accepts all five modes with a canonical, fixed redirect URL', () => {
        for (const mode of ['not-found', 'welcome', 'close'] as const) {
            expect(defaultSiteSettingsSchema.parse({ mode })).toEqual({ mode })
        }
        expect(
            defaultSiteSettingsSchema.parse({ mode: 'redirect', url: 'HTTPS://EXAMPLE.COM' }),
        ).toEqual({ mode: 'redirect', url: 'https://example.com/' })
        const html = '<style>body { color: red }</style><p>{env.SECRET} \\{literal}</p>'
        expect(defaultSiteSettingsSchema.parse({ mode: 'custom-html', html })).toEqual({
            mode: 'custom-html',
            html,
        })
    })

    test('rejects invalid URLs, credentials, controls and unsupported fields or modes', () => {
        for (const url of [
            '/relative',
            'javascript:alert(1)',
            'ftp://example.com/',
            'https://user:password@example.com/',
            'https://example.com/%0d%0aInjected:yes',
            'https://example.com/%ZZ',
            'https://example.com/\\evil',
        ]) {
            expect(
                defaultSiteSettingsSchema.safeParse({ mode: 'redirect', url }).success,
            ).toBeFalse()
        }
        for (const input of [
            { mode: '444' },
            { mode: 'welcome', html: '<p>Extra</p>' },
            { mode: 'redirect' },
            { mode: 'custom-html' },
            { mode: 'close', abort: false },
        ])
            expect(defaultSiteSettingsSchema.safeParse(input).success).toBeFalse()
    })

    test('bounds custom HTML by UTF-8 bytes and preserves meaningful whitespace', () => {
        expect(
            defaultSiteSettingsSchema.parse({ mode: 'custom-html', html: ' \n<p>Gude</p>\n ' }),
        ).toEqual({ mode: 'custom-html', html: ' \n<p>Gude</p>\n ' })
        expect(
            defaultSiteSettingsSchema.safeParse({
                mode: 'custom-html',
                html: 'a'.repeat(MAX_DEFAULT_SITE_HTML_BYTES),
            }).success,
        ).toBeTrue()
        for (const html of [
            '',
            ' \n\t ',
            '\0<p>Bad</p>',
            '\ud800',
            'a'.repeat(MAX_DEFAULT_SITE_HTML_BYTES + 1),
            'ä'.repeat(MAX_DEFAULT_SITE_HTML_BYTES / 2 + 1),
        ])
            expect(
                defaultSiteSettingsSchema.safeParse({ mode: 'custom-html', html }).success,
            ).toBeFalse()
    })

    test('preserves legacy v7 canonical bytes and hashes every nondefault mode and content', () => {
        const legacy = createProxyRuntimeSnapshot([])
        expect(createProxyRuntimeSnapshot([], {}, [], [], { mode: 'not-found' })).toEqual(legacy)
        expect(legacy).not.toHaveProperty('defaultSite')
        const variants = [
            { mode: 'welcome' },
            { mode: 'close' },
            { mode: 'redirect', url: 'https://example.com/' },
            { mode: 'custom-html', html: '<p>One</p>' },
            { mode: 'custom-html', html: '<p>Two</p>' },
        ] as const
        const snapshots = variants.map((settings) =>
            createProxyRuntimeSnapshot([], {}, [], [], settings),
        )
        expect(
            new Set([legacy.revision, ...snapshots.map((snapshot) => snapshot.revision)]).size,
        ).toBe(6)
        expect(Object.keys(snapshots[0]!).slice(-2)).toEqual(['defaultSite', 'revision'])
        expect(
            defaultSiteSaveSchema.safeParse({
                baseRevision: 'stale',
                settings: { mode: 'welcome' },
            }).success,
        ).toBeFalse()
    })

    test('matches the Rust canonical revision for nondefault Unicode HTML', () => {
        expect(
            createProxyRuntimeSnapshot([], {}, [], [], {
                mode: 'custom-html',
                html: '<p>Gude äß 👋</p>\n',
            }).revision,
        ).toBe('sha256:31b57fcab60e4a49757ec9b077b4ee67322a9be03b2fd2eb8ccad4b676a71c25')
    })

    test('restores the versioned stored value and fails closed on invalid persisted content', () => {
        const stored = {
            version: 1,
            settings: { mode: 'custom-html' as const, html: '<p>Restored</p>' },
        }
        expect(parseStoredDefaultSiteSettings(JSON.parse(JSON.stringify(stored)))).toEqual(
            stored.settings,
        )
        expect(parseStoredDefaultSiteSettings(JSON.stringify(stored))).toEqual(stored.settings)
        for (const value of [
            null,
            '{}',
            { ...stored, version: 2 },
            {
                version: 1,
                settings: { mode: 'redirect', url: 'javascript:alert(1)' },
            },
        ])
            expect(() => parseStoredDefaultSiteSettings(value)).toThrow(
                'Stored default site settings are invalid.',
            )
    })

    test('grants dedicated permissions to owners and administrators, excluding viewers', () => {
        const permissions = [PERMISSIONS.DEFAULT_SITE_VIEW, PERMISSIONS.DEFAULT_SITE_UPDATE]
        for (const permission of permissions) {
            expect(PERMISSION_REGISTRY.filter(({ key }) => key === permission)).toHaveLength(1)
            for (const role of SYSTEM_ROLE_REGISTRY) {
                expect(role.permissionKeys.some((key) => key === permission)).toBe(
                    role.key !== SYSTEM_ROLES.VIEWER,
                )
            }
        }
    })
})
