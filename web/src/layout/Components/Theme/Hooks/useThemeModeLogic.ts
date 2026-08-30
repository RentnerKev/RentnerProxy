import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import type { UserThemeMode } from '../../../../config/theme.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import { updateCurrentUserThemeModeHandler } from '../../../../features/UserSettings/server'

export default function useThemeModeLogic(initialThemeMode: UserThemeMode) {
    const toast = useToast()
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
                toast.success('theme.saved')
                return
            }

            setThemeMode(confirmedThemeMode.current)
            toast.error(result.message)
        },
        onError: () => {
            setThemeMode(confirmedThemeMode.current)
            toast.error('theme.saveFailed')
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
