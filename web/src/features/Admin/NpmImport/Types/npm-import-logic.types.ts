import type { ImportPreview, ImportResult } from '@/lib/Imports/Types/import.types.ts'

export interface NpmImportLogicResult {
    readonly state: {
        readonly file: File | null
        readonly preview: ImportPreview | null
        readonly result: ImportResult | null
        readonly history: readonly ImportResult[]
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
