import { beforeEach, expect, test } from 'bun:test'
import { AuthDomainError } from '@/server/Auth/Core/errors.server.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import {
    importBoundaryFixture,
    importRequest,
    ImportError,
    NpmSourceError,
    PortableSourceError,
    ZoraxySourceError,
} from './importBoundaryFixture.ts'
const boundary = importBoundaryFixture()
const handlers = await import('@/features/Admin/Migration/middleware.ts')
beforeEach(() => boundary.reset())

test('migration authorization denial occurs before upload processing or export service access', async () => {
    boundary.failures.set(
        'requirePermissionService',
        new AuthDomainError('permission_denied', 'private'),
    )
    expect(
        (await handlers.handleMigrationPostHandler(importRequest('mode=preview&source=npm', 'npm')))
            .status,
    ).toBe(403)
    expect(boundary.argumentsFor('upload')).toHaveLength(0)
    expect((await handlers.handleMigrationExportHandler()).status).toBe(403)
    expect(boundary.argumentsFor('exportMigrationConfigurationService')).toHaveLength(0)
})

test.each(['npm', 'rentnerproxy', 'zoraxy'])(
    'migration preview forwards the selected %s source only after permission and origin checks',
    async (source) => {
        boundary.values.set('previewImportService', { preview: source })
        const request = importRequest(`mode=preview&source=${source}`, source)
        const response = await handlers.handleMigrationPostHandler(request)
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ preview: source })
        expect(boundary.argumentsFor('requirePermissionService')).toEqual([[PERMISSIONS.MIGRATION]])
        expect(boundary.argumentsFor('upload')).toEqual([[request]])
        expect(boundary.argumentsFor('previewImportService')).toEqual([
            ['/fixture/upload.sqlite', 'uploaded-fingerprint', source, PERMISSIONS.MIGRATION],
        ])
        expect(boundary.calls[0]?.name).toBe('requirePermissionService')
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    },
)

test('migration apply preserves explicit revision plan and export authorizes the actor', async () => {
    boundary.values.set('applyImportService', { applied: true })
    const response = await handlers.handleMigrationPostHandler(
        importRequest('mode=apply&source=npm&fingerprint=expected&plan=approved', 'npm'),
    )
    expect(await response.json()).toEqual({ applied: true })
    expect(boundary.argumentsFor('applyImportService')).toEqual([
        [
            '/fixture/upload.sqlite',
            'uploaded-fingerprint',
            'expected',
            'approved',
            'npm',
            PERMISSIONS.MIGRATION,
        ],
    ])
    boundary.values.set('getImportRunsService', [{ id: 'run' }])
    expect(await (await handlers.handleMigrationGetHandler()).json()).toEqual([{ id: 'run' }])
    expect(boundary.argumentsFor('getImportRunsService')).toEqual([[PERMISSIONS.MIGRATION]])
    boundary.values.set('requirePermissionService', { id: 'actor' })
    boundary.values.set('exportMigrationConfigurationService', '{"fixture":true}')
    const exported = await handlers.handleMigrationExportHandler()
    expect(await exported.text()).toBe('{"fixture":true}')
    expect(boundary.argumentsFor('exportMigrationConfigurationService')).toEqual([['actor']])
    expect(exported.headers.get('Content-Disposition')).toMatch(
        /^attachment; filename="rentnerproxy-config-\d{4}-\d{2}-\d{2}\.json"$/u,
    )
    expect(exported.headers.get('Cache-Control')).toBe('private, no-store')
})

test.each([
    ['mode=preview&source=npm', 'npm', { origin: 'https://evil.example' }, 403],
    ['mode=preview&source=npm', 'npm', { 'sec-fetch-site': 'cross-site' }, 403],
    ['mode=invalid&source=npm', 'npm', {}, 400],
    ['mode=preview&source=invalid', 'npm', {}, 400],
    ['mode=preview&source=npm', 'wrong', {}, 400],
    ['mode=preview&source=npm', 'npm', { 'content-type': 'application/json' }, 400],
] as const)(
    'migration rejects malformed or cross-site uploads before reading temporary files',
    async (query, header, overrides, status) => {
        const response = await handlers.handleMigrationPostHandler(
            importRequest(query, header, overrides),
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
    [new PortableSourceError('invalid_portable'), 422, 'invalid_portable'],
    [new ZoraxySourceError('invalid_zoraxy'), 422, 'invalid_zoraxy'],
    [new ImportError('plan_conflict'), 409, 'plan_conflict'],
    [new Error('private stack details'), 500, 'import_failed'],
] as const)(
    'migration maps domain failure to safe HTTP response',
    async (failure, status, code) => {
        boundary.failures.set('previewImportService', failure)
        const response = await handlers.handleMigrationPostHandler(
            importRequest('mode=preview&source=npm', 'npm'),
        )
        expect(response.status).toBe(status)
        expect(await response.json()).toEqual({ error: code })
        boundary.failures.set('getImportRunsService', failure)
        expect((await handlers.handleMigrationGetHandler()).status).toBe(status)
        boundary.failures.set('requirePermissionService', failure)
        expect((await handlers.handleMigrationExportHandler()).status).toBe(status)
    },
)
