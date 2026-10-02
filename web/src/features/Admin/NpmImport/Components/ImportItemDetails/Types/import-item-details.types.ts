import type { NpmImportResultItem, NpmPreviewItem } from '../../../Types/npm-import.types.ts'

export interface ImportItemDetailsProps {
    readonly item: NpmPreviewItem | NpmImportResultItem
}
export interface ImportItemDetailsLogicResult {
    readonly state: {
        readonly reasons: readonly { readonly reason: string; readonly text: string }[]
    }
}
