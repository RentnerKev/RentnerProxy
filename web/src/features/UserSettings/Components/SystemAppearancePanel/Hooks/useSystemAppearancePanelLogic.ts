import type { SystemAppearancePanelLogicResult } from '../Types/system-appearance-panel.types.ts'
import { type PickerMessages } from '@rentnerkev/picker'
import { toast } from '@rentnerkev/toasts/toast'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useSystemAccent } from '@/shared/Theme/systemAccentContext.ts'
import { updateSystemAccentColorHandler } from '@/features/SystemAppearance/middleware.ts'

export function useSystemAppearancePanelLogic(canUpdate: boolean) {
    const router = useRouter()
    const { language, t } = useTranslationStore()
    const { accentColor, setAccentColor } = useSystemAccent()
    const [draftColor, setDraftColor] = useState(accentColor)
    const [isValid, setIsValid] = useState(true)
    const saveInFlight = useRef(false)

    const mutation = useMutation({
        mutationFn: (nextColor: string | null) =>
            updateSystemAccentColorHandler({ data: { accentColor: nextColor } }),
        onSuccess: (result) => {
            if (result.success) {
                setAccentColor(result.accentColor)
                setDraftColor(result.accentColor)
                toast.success(t('systemAppearance.saved'), { title: t('toast.titles.success') })
                void router.invalidate()
            } else {
                toast.error(t(result.message), { title: t('toast.titles.error') })
            }
        },
        onError: () => {
            toast.error(t('systemAppearance.errors.saveFailed'), {
                title: t('toast.titles.error'),
            })
        },
        onSettled: () => {
            saveInFlight.current = false
        },
    })

    const pickerMessages: Partial<PickerMessages> = {
        required: t('systemAppearance.picker.required'),
        invalidColor: t('systemAppearance.picker.invalidColor'),
        eyeDropper: t('systemAppearance.picker.eyeDropper'),
        closePicker: t('systemAppearance.picker.closePicker'),
        colorArea: t('systemAppearance.picker.colorArea'),
        colorAreaInstructions: t('systemAppearance.picker.colorAreaInstructions'),
        colorAreaValue: (saturation, value) =>
            t('systemAppearance.picker.colorAreaValue', { saturation, value }),
        hue: t('systemAppearance.picker.hue'),
        selectColor: t('systemAppearance.picker.selectColor'),
        presetColor: (color) => t('systemAppearance.picker.presetColor', { color }),
    }
    const isSaving = mutation.isPending
    const isDirty = draftColor !== accentColor
    const canSave = canUpdate && isValid && !!draftColor && isDirty && !isSaving

    function save(nextColor: string | null) {
        if (!canUpdate || saveInFlight.current || isSaving) return
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
    } satisfies SystemAppearancePanelLogicResult
}
