import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import type { UserThemeMode } from '../../../../config/theme.config'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import { updateCurrentUserThemeModeHandler } from '../../../../features/UserSettings/server'

export default function useThemeModeLogic(initialThemeMode: UserThemeMode) {
    const { t } = useTranslationStore()
    const confirmedThemeMode = useRef(initialThemeMode)
    const [themeMode, setThemeMode] = useState(initialThemeMode)
    const mutation = useMutation({
        mutationFn: (nextThemeMode: UserThemeMode) =>
            updateCurrentUserThemeModeHandler({ data: { themeMode: nextThemeMode } }),
        onMutate: (nextThemeMode) => {
            setThemeMode(nextThemeMode)
        },
        onSuccess: (result) => {
            if (result.success) {
                confirmedThemeMode.current = result.themeMode
                setThemeMode(result.themeMode)
                toast.success(t('theme.saved'), { title: t('toast.titles.success') })
                return
            }

            setThemeMode(confirmedThemeMode.current)
            toast.error(t(result.message), { title: t('toast.titles.error') })
        },
        onError: () => {
            setThemeMode(confirmedThemeMode.current)
            toast.error(t('theme.saveFailed'), { title: t('toast.titles.error') })
        },
    })

    return {
        state: {
            isSaving: mutation.isPending,
            themeMode,
        },
        handler: {
            handleToggle: () => {
                if (!mutation.isPending) {
                    mutation.mutate(themeMode === 'light' ? 'dark' : 'light')
                }
            },
        },
    }
}
