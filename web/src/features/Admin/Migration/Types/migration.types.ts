import type {
    NpmImportPreview,
    NpmImportResult,
} from '@/features/Admin/NpmImport/Types/npm-import.types.ts'

export type MigrationSource = 'rentnerproxy' | 'npm' | 'zoraxy'

export interface MigrationLogicResult {
    readonly state: {
        readonly source: MigrationSource
        readonly exporting: boolean
        readonly file: File | null
        readonly preview: NpmImportPreview | null
        readonly result: NpmImportResult | null
        readonly history: readonly NpmImportResult[]
        readonly busy: 'preview' | 'apply' | null
        readonly error: string | null
    }
    readonly handler: {
        readonly selectSource: (source: MigrationSource) => void
        readonly downloadExport: () => Promise<void>
        readonly selectFile: (file: File | null) => void
        readonly discardPreview: () => void
        readonly previewSource: () => Promise<void>
        readonly applySource: () => Promise<void>
    }
}
