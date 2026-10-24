import type { ImportPreview, ImportResult } from '@/lib/Imports/Types/import.types.ts'

export interface ImportPreviewPanelProps {
    readonly preview: ImportPreview
    readonly busy: 'preview' | 'apply' | null
    readonly help: string
    readonly onApply: () => Promise<void>
    readonly onDiscard: () => void
}

export interface ImportResultPanelProps {
    readonly result: ImportResult
    readonly sourceLabel?: string
}
