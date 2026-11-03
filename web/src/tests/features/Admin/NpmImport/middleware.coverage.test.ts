import { beforeEach, expect, test } from 'bun:test'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    importBoundaryFixture,
    importRequest,
    ImportError,
    NpmSourceError,
} from '@/tests/features/Admin/Migration/importBoundaryFixture.ts'
const boundary = importBoundaryFixture()
const handlers = await import('@/features/Admin/NpmImport/middleware.ts')
beforeEach(() => boundary.reset())

test('legacy NPM authorization denial prevents temporary-file and parser work', async () => {
    boundary.failures.set(
        'requirePermissionService',
        new AuthDomainError('authentication_required', 'private'),
    )
    const response = await handlers.handleNpmImportPostHandler(
        importRequest('mode=preview', 'sqlite'),
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'authentication_required' })
    expect(boundary.argumentsFor('upload')).toHaveLength(0)
    expect(boundary.argumentsFor('previewNpmImportService')).toHaveLength(0)
})

test.each(['preview', 'apply'])(
    'legacy NPM %s authorizes before upload and forwards plan data',
    async (mode) => {
        const service = mode === 'preview' ? 'previewNpmImportService' : 'applyNpmImportService'
        boundary.values.set(service, { mode })
        const request = importRequest(`mode=${mode}&fingerprint=expected&plan=approved`, 'sqlite')
        const response = await handlers.handleNpmImportPostHandler(request)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ mode })
        expect(boundary.argumentsFor('requirePermissionService')).toEqual([
            [PERMISSIONS.NPM_IMPORT],
        ])
        expect(boundary.calls[0]?.name).toBe('requirePermissionService')
        expect(boundary.argumentsFor('upload')).toEqual([[request]])
        expect(boundary.argumentsFor(service)).toEqual([
            mode === 'preview'
                ? ['/fixture/upload.sqlite', 'uploaded-fingerprint']
                : ['/fixture/upload.sqlite', 'uploaded-fingerprint', 'expected', 'approved'],
        ])
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    },
)

test.each([
    ['preview', 'sqlite', { origin: 'https://evil.example' }, 403],
    ['preview', 'sqlite', { 'sec-fetch-site': 'cross-site' }, 403],
    ['invalid', 'sqlite', {}, 400],
    ['preview', 'wrong', {}, 400],
    ['preview', 'sqlite', { 'content-type': 'application/json' }, 400],
] as const)(
    'legacy import rejects invalid transport metadata before upload processing',
    async (mode, header, overrides, status) => {
        const response = await handlers.handleNpmImportPostHandler(
            importRequest(`mode=${mode}`, header, overrides),
        )
        expect(response.status).toBe(status)
        expect(await response.json()).toEqual({ error: 'invalid_request' })
        expect(boundary.argumentsFor('upload')).toHaveLength(0)
    },
)

test.each([
    [new AuthDomainError('authentication_required', 'private'), 401, 'authentication_required'],
    [new AuthDomainError('permission_denied', 'private'), 403, 'permission_denied'],
    [new NpmSourceError('invalid_source'), 422, 'invalid_source'],
    [new ImportError('plan_conflict'), 409, 'plan_conflict'],
    [new Error('private stack'), 500, 'import_failed'],
] as const)(
    'legacy import errors preserve status without leaking backend messages',
    async (failure, status, code) => {
        boundary.failures.set('previewNpmImportService', failure)
        const response = await handlers.handleNpmImportPostHandler(
            importRequest('mode=preview', 'sqlite'),
        )
        expect(response.status).toBe(status)
        expect(await response.json()).toEqual({ error: code })
    },
)

test('legacy run listing forwards success and sanitizes authentication and unexpected errors', async () => {
    boundary.values.set('getNpmImportRunsService', [{ id: 'run' }])
    expect(await (await handlers.handleNpmImportGetHandler()).json()).toEqual([{ id: 'run' }])
    boundary.failures.set(
        'getNpmImportRunsService',
        new AuthDomainError('authentication_required', 'private'),
    )
    expect((await handlers.handleNpmImportGetHandler()).status).toBe(401)
    boundary.failures.set(
        'getNpmImportRunsService',
        new AuthDomainError('permission_denied', 'private'),
    )
    expect((await handlers.handleNpmImportGetHandler()).status).toBe(403)
    boundary.failures.set('getNpmImportRunsService', new Error('private error'))
    const failure = await handlers.handleNpmImportGetHandler()
    expect(failure.status).toBe(500)
    expect(await failure.json()).toEqual({ error: 'import_failed' })
})
