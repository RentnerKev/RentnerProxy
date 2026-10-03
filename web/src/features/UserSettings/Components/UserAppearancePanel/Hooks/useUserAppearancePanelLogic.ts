import type { UserAppearancePanelLogicResult } from '../Types/user-appearance-panel.types.ts'
import { type PickerMessages } from '@rentnerkev/picker'
import { toast } from '@rentnerkev/toasts/toast'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useAccent } from '@/shared/Theme/accentContext.ts'
import { updateCurrentUserAccentColorHandler } from '@/features/UserSettings/middleware.ts'

export function useUserAppearancePanelLogic(userId: string) {
    const router = useRouter()
    const { language, t } = useTranslationStore()
    const { accentColor } = useAccent()
    const [draftColor, setDraftColor] = useState(accentColor)
    const [isValid, setIsValid] = useState(true)
    const saveInFlight = useRef(false)
    const isMounted = useRef(true)

    useEffect(() => {
        isMounted.current = true
        return () => {
            isMounted.current = false
        }
    }, [])

    const mutation = useMutation({
        mutationFn: (nextColor: string | null) =>
            updateCurrentUserAccentColorHandler({
                data: { expectedUserId: userId, accentColor: nextColor },
            }),
        onSuccess: async (result) => {
            if (result.success) {
                if (result.userId !== userId) return
                if (isMounted.current) setDraftColor(result.accentColor)
                // Persistence succeeded; a route refresh failure must not turn it into a save error.
                await router.invalidate().catch(() => undefined)
                if (!isMounted.current) return
                toast.success(t('userAppearance.saved'), { title: t('toast.titles.success') })
            } else if (isMounted.current) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
            }
        },
        onError: () => {
            if (!isMounted.current) return
            toast.error(t('userAppearance.errors.saveFailed'), {
                title: t('toast.titles.error'),
            })
        },
        onSettled: () => {
            saveInFlight.current = false
        },
    })

    const pickerMessages: Partial<PickerMessages> = {
        required: t('userAppearance.picker.required'),
        invalidColor: t('userAppearance.picker.invalidColor'),
        eyeDropper: t('userAppearance.picker.eyeDropper'),
        closePicker: t('userAppearance.picker.closePicker'),
        colorArea: t('userAppearance.picker.colorArea'),
        colorAreaInstructions: t('userAppearance.picker.colorAreaInstructions'),
        colorAreaValue: (saturation, value) =>
            t('userAppearance.picker.colorAreaValue', { saturation, value }),
        hue: t('userAppearance.picker.hue'),
        selectColor: t('userAppearance.picker.selectColor'),
        presetColor: (color) => t('userAppearance.picker.presetColor', { color }),
    }
    const isSaving = mutation.isPending
    const isDirty = draftColor !== accentColor
    const canSave = isValid && !!draftColor && isDirty && !isSaving

    function save(nextColor: string | null) {
        if (saveInFlight.current || isSaving) return
        saveInFlight.current = true
        mutation.mutate(nextColor)
    }

    function handleSaveDraft() {
        if (canSave) save(draftColor)
    }

    return {
        state: {
            accentColor,
            canSave,
            draftColor,
            isSaving,
            pickerMessages,
            pickerLocale: language === 'de' ? ('de' as const) : ('en' as const),
            previewColor: isValid && draftColor ? draftColor : accentColor,
            resetDisabled: isSaving || (accentColor === DEFAULT_ACCENT_COLOR && !isDirty),
        },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                handleSaveDraft()
            },
            handleReset: () => save(null),
        },
        setter: { setDraftColor, setIsValid },
    } satisfies UserAppearancePanelLogicResult
}
