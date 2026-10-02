import type { CSSProperties } from 'react'
import type { SystemAccentState } from '@/shared/Theme/Types/system-accent.types.ts'

export interface RootDocumentLogicResult {
    readonly state: {
        readonly language: string
        readonly nonce: string | undefined
        readonly hasCustomAccent: boolean
        readonly accentStyles: CSSProperties
    }
    readonly accentContext: SystemAccentState
}
