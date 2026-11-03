import { beforeEach, expect, test } from 'bun:test'
import { z } from 'zod'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import {
    DefaultSiteError,
    DefaultSiteHtmlFormatError,
} from '@/server/DefaultSite/default-site.errors.ts'
const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/DefaultSite/default-site.service.ts', [
    'getDefaultSiteService',
    'saveDefaultSiteService',
])
boundary.mockServices('@/server/DefaultSite/format-default-site-html.service.ts', [
    'formatDefaultSiteHtmlService',
])
const handlers = await import('@/features/DefaultSite/middleware.ts')
beforeEach(() => boundary.reset())

test('default-site read and formatter preserve values with no-store and sanitize unavailable queries', async () => {
    boundary.values.set('getDefaultSiteService', { enabled: true })
    expect(await boundary.invoke(handlers.getDefaultSiteHandler)).toEqual({ enabled: true })
    expect(boundary.methods.get(handlers.getDefaultSiteHandler)).toBe('GET')
    boundary.failures.set('getDefaultSiteService', new Error('private persistence details'))
    await expect(boundary.invoke(handlers.getDefaultSiteHandler)).rejects.toThrow(
        'defaultSite.errors.loadFailed',
    )
    boundary.values.set('formatDefaultSiteHtmlService', '<p>formatted</p>')
    expect(
        await boundary.invoke(handlers.formatDefaultSiteHtmlHandler, { html: '<p> original </p>' }),
    ).toEqual({ success: true, html: '<p>formatted</p>' })
    expect(boundary.argumentsFor('formatDefaultSiteHtmlService')).toEqual([
        [{ html: '<p> original </p>' }],
    ])
    expect(boundary.headers.get('Cache-Control')).toBe('no-store')
})

test.each([new DefaultSiteHtmlFormatError(), new z.ZodError([])])(
    'formatting validation failures return 400 without exposing source diagnostics',
    async (failure) => {
        boundary.failures.set('formatDefaultSiteHtmlService', failure)
        expect(await boundary.invoke(handlers.formatDefaultSiteHtmlHandler, {})).toEqual({
            success: false,
            message: 'defaultSite.editor.formatFailed',
        })
        expect(boundary.status).toBe(400)
    },
)

test.each(['applied', 'pending'])(
    'default site save distinguishes %s runtime state and forwards input untouched',
    async (runtimeStatus) => {
        boundary.values.set('saveDefaultSiteService', runtimeStatus)
        const data = { mode: 'custom', html: '<p>fixture</p>' }
        expect(await boundary.invoke(handlers.saveDefaultSiteHandler, data)).toEqual({
            success: true,
            runtimeStatus,
            message: runtimeStatus === 'applied' ? 'defaultSite.saved' : 'defaultSite.savedPending',
        })
        expect(boundary.argumentsFor('saveDefaultSiteService')).toEqual([[data]])
        expect(boundary.methods.get(handlers.saveDefaultSiteHandler)).toBe('POST')
    },
)

test.each([
    [new DefaultSiteError('configuration_conflict'), 409, 'defaultSite.errors.conflict'],
    [new z.ZodError([]), 400, 'defaultSite.errors.invalidSettings'],
] as const)(
    'default-site domain failures preserve safe response semantics',
    async (failure, status, message) => {
        boundary.failures.set('saveDefaultSiteService', failure)
        expect(await boundary.invoke(handlers.saveDefaultSiteHandler, {})).toEqual({
            success: false,
            message,
        })
        expect(boundary.status).toBe(status)
    },
)

test('unexpected formatter and save failures use their dedicated localized fallback', async () => {
    boundary.failures.set('saveDefaultSiteService', new Error('private storage details'))
    boundary.failures.set('formatDefaultSiteHtmlService', new Error('private parser details'))
    expect(await boundary.invoke(handlers.saveDefaultSiteHandler, {})).toEqual({
        success: false,
        message: 'defaultSite.errors.saveFailed',
    })
    expect(await boundary.invoke(handlers.formatDefaultSiteHtmlHandler, {})).toEqual({
        success: false,
        message: 'defaultSite.editor.formatFailed',
    })
})
