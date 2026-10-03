import type { CSSProperties } from 'react'
import type { AccentState } from '@/shared/Theme/Types/accent.types.ts'

export interface RootDocumentLogicResult {
    readonly state: {
        readonly language: string
        readonly nonce: string | undefined
        readonly hasCustomAccent: boolean
        readonly accentStyles: CSSProperties
    }
    readonly accentContext: AccentState
}
