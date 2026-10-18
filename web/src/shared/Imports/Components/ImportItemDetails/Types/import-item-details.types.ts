import type { ImportResultItem, ImportPreviewItem } from '@/lib/Imports/Types/import.types.ts'

export interface ImportItemDetailsProps {
    readonly item: ImportPreviewItem | ImportResultItem
}
export interface ImportItemDetailsLogicResult {
    readonly state: {
        readonly reasons: readonly { readonly reason: string; readonly text: string }[]
    }
}
