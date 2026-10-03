import type { FormEventHandler } from 'react'
import type { DefaultSiteSettings } from '@/lib/DefaultSite/Types/default-site.types.ts'

export interface DefaultSiteFormValues {
    mode: DefaultSiteSettings['mode']
    url: string
    html: string
}

export interface DefaultSitePanelLogicResult<TForm> {
    form: TForm
    state: {
        isLoading: boolean
        loadFailed: boolean
        isSaving: boolean
        isReloading: boolean
        mode: DefaultSiteSettings['mode']
        savedMode: DefaultSiteSettings['mode'] | null
        canSave: boolean
        isDirty: boolean
        isValid: boolean
        htmlBytes: number
        error: string | null
        runtimeStatus: 'applied' | 'pending' | null
        modeOptions: { value: DefaultSiteSettings['mode']; label: string }[]
    }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        handleReload: () => void
        handleModeChange: (value: string) => void
    }
}
