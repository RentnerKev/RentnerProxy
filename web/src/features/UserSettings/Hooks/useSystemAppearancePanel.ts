import { type PickerMessages } from '@rentnerkev/picker'
import { toast } from '@rentnerkev/toasts/toast'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useRef, useState } from 'react'

import { DEFAULT_ACCENT_COLOR } from '../../../config/appearance.config'
import useTranslationStore from '../../../language/useTranslationStore'
import { useSystemAccent } from '../../../theme/systemAccentContext'
import { updateSystemAccentColorHandler } from '../../SystemAppearance/server'

export function useSystemAppearancePanel(canUpdate: boolean) {
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

    return {
        accentColor,
        canSave,
        draftColor,
        isDirty,
        isSaving,
        language,
        pickerMessages,
        previewColor: isValid && draftColor ? draftColor : accentColor,
        resetDisabled: isSaving || (accentColor === DEFAULT_ACCENT_COLOR && !isDirty),
        saveDraft: () => {
            if (canSave) save(draftColor)
        },
        reset: () => save(null),
        setDraftColor,
        setIsValid,
        t,
    }
}
