import type { NpmImportPreview, NpmImportResult } from './npm-import.types.ts'

export interface NpmImportLogicResult {
    readonly state: {
        readonly file: File | null
        readonly preview: NpmImportPreview | null
        readonly result: NpmImportResult | null
        readonly history: readonly NpmImportResult[]
        readonly busy: 'preview' | 'apply' | null
        readonly error: string | null
    }
    readonly handler: {
        readonly selectFile: (file: File | null) => void
        readonly discardPreview: () => void
        readonly previewSource: () => Promise<void>
        readonly applySource: () => Promise<void>
    }
}
