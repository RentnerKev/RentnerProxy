import type { FormEventHandler } from 'react'
import type { PickerMessages } from '@rentnerkev/picker'

export interface UserAppearancePanelLogicResult {
    state: {
        accentColor: string
        canSave: boolean
        draftColor: string
        isSaving: boolean
        pickerMessages: Partial<PickerMessages>
        pickerLocale: 'de' | 'en'
        previewColor: string
        resetDisabled: boolean
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        handleReset: () => void
    }
    setter: { setDraftColor: (value: string) => void; setIsValid: (value: boolean) => void }
}

export interface UserAppearancePanelProps {
    readonly userId: string
}
