import { mock } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
export class ImportError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}
export class NpmSourceError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}
export class PortableSourceError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}
export class ZoraxySourceError extends Error {
    constructor(readonly code: string) {
        super(code)
    }
}
export function importBoundaryFixture() {
    const boundary = createMiddlewareHarness()
    boundary.mockServices(
        '@/server/Admin/NpmImport/npm-import.service.ts',
        [
            'applyImportService',
            'getImportRunsService',
            'previewImportService',
            'applyNpmImportService',
            'getNpmImportRunsService',
            'previewNpmImportService',
        ],
        { NpmImportError: ImportError },
    )
    boundary.mockServices('@/server/Admin/Migration/migration-export.service.ts', [
        'exportMigrationConfigurationService',
    ])
    mock.module('@/server/Admin/NpmImport/npm-source.ts', () => ({ NpmSourceError }))
    mock.module('@/server/Admin/Migration/portable.ts', () => ({ PortableSourceError }))
    mock.module('@/server/Admin/Migration/zoraxy.ts', () => ({ ZoraxySourceError }))
    mock.module('@/server/env.server.ts', () => ({
        getPublicOrigin: () => 'https://proxy.example',
    }))
    mock.module('@/server/Admin/NpmImport/npm-temp.ts', () => ({
        withNpmSqliteUpload: async (
            request: Request,
            action: (path: string, fingerprint: string) => Promise<unknown>,
        ) => {
            boundary.calls.push({ name: 'upload', arguments: [request] })
            if (boundary.failures.has('upload')) throw boundary.failures.get('upload')
            return action('/fixture/upload.sqlite', 'uploaded-fingerprint')
        },
    }))
    return boundary
}

export function importRequest(
    query: string,
    header: string,
    overrides: Record<string, string> = {},
) {
    return new Request(`https://proxy.example/api/import?${query}`, {
        method: 'POST',
        headers: {
            origin: 'https://proxy.example',
            'content-type': 'application/octet-stream',
            'x-rentnerproxy-import': header,
            ...overrides,
        },
        body: new Uint8Array([1, 2, 3]),
    })
}
