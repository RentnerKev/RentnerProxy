import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import type { UserThemeMode } from '../../../config/theme.config'
import { updateCurrentUserThemeModeHandler } from '../../UserSettings/server'

export default function useThemeModeLogic(initialThemeMode: UserThemeMode) {
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
                return
            }

            setThemeMode(confirmedThemeMode.current)
        },
        onError: () => {
            setThemeMode(confirmedThemeMode.current)
        },
    })

    return {
        state: {
            errorMessage:
                mutation.data && !mutation.data.success
                    ? mutation.data.message
                    : mutation.isError
                      ? 'theme.saveFailed'
                      : null,
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
