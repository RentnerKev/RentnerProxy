import type { RefObject } from 'react'
import type { HtmlEditorColorPreset } from '@/config/Types/html-editor-config.types.ts'

export interface HtmlSourceEditorProps {
    readonly id: string
    readonly value: string
    readonly onChange: (value: string) => void
    readonly onBlur: () => void
    readonly disabled: boolean
    readonly invalid: boolean
    readonly describedBy: string
}

export interface HtmlSourceEditorLogicResult {
    state: {
        colorPreset: HtmlEditorColorPreset
        colorOptions: { value: HtmlEditorColorPreset; label: string }[]
        isFormatting: boolean
        formatError: string | null
        canFormat: boolean
    }
    handler: {
        handleColorChange: (value: string) => void
        handleFormat: () => Promise<void>
    }
    refs: {
        container: RefObject<HTMLDivElement | null>
    }
}
