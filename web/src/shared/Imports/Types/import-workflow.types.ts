import type { ImportResult } from '@/lib/Imports/Types/import.types.ts'

export interface ImportWorkflowOptions {
    readonly endpoint: '/api/npm-import' | '/api/migration'
    readonly errorNamespace: 'npmImport' | 'migration'
    readonly source?: 'rentnerproxy' | 'npm' | 'zoraxy'
    readonly importHeader: string
    readonly maxFileBytes: number
    readonly onApplied?: (result: ImportResult) => void
    readonly onError?: (code: string) => void
}
