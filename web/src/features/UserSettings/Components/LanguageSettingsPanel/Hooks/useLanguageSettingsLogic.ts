import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { LanguageSettingsLogicResult } from '../Types/language-settings-logic.types.ts'
import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { AVAILABLE_LANGUAGES } from '@/config/language.config.ts'
import { isAppLanguage } from '@/lib/Language/language.ts'
import { loadLanguageBootstrap } from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { AppLanguage } from '@/shared/Language/Types/language.types.ts'
import { updateCurrentUserLanguageHandler } from '../../../middleware.ts'
import { toast } from '@rentnerkev/toasts/toast'

export default function useLanguageSettingsLogic() {
    const router = useRouter()
    const { language, setLanguage, t } = useTranslationStore()
    const [draftLanguage, setDraftLanguage] = useState<AppLanguage | null>(null)
    const saveInFlight = useRef(false)
    const selectedLanguage = draftLanguage ?? language
    const isDirty = selectedLanguage !== language
    const mutation = useMutation({
        mutationFn: async (nextLanguage: AppLanguage) => {
            const resources = await loadLanguageBootstrap(nextLanguage).catch(() => {
                throw new Error('language.loadFailed')
            })
            if (resources.language !== nextLanguage || !setLanguage) {
                throw new Error('language.loadFailed')
            }

            const result = await updateCurrentUserLanguageHandler({
                data: { language: nextLanguage },
            })
            if (result.success) {
                await setLanguage(result.language, resources)
            }
            return result
        },
        onSuccess: (result) => {
            if (result.success) {
                setDraftLanguage(null)
                toast.success(t(result.message), { title: t('toast.titles.success') })
                void router.invalidate()
            } else {
                toast.error(t(result.message), { title: t('toast.titles.error') })
            }
        },
        onError: (error) => {
            toast.error(
                t(
                    error.message === 'language.loadFailed'
                        ? 'language.loadFailed'
                        : 'language.saveFailed',
                ),
                { title: t('toast.titles.error') },
            )
        },
        onSettled: () => {
            saveInFlight.current = false
        },
    })

    function handleSave() {
        if (isDirty && !saveInFlight.current && !mutation.isPending) {
            saveInFlight.current = true
            mutation.mutate(selectedLanguage)
        }
    }

    return {
        state: {
            selectedLanguage,
            isDirty,
            isSaving: mutation.isPending,
            options: AVAILABLE_LANGUAGES.map((value) => ({
                value,
                label: t(`language.names.${value}`),
            })),
        },
        handler: {
            handleSubmit: (event) => {
                event.preventDefault()
                event.stopPropagation()
                handleSave()
            },
            handleLanguageChange: (value: string) => {
                if (
                    isAppLanguage(value) &&
                    value !== selectedLanguage &&
                    !saveInFlight.current &&
                    !mutation.isPending
                ) {
                    setDraftLanguage(value === language ? null : value)
                    mutation.reset()
                }
            },
        },
    } satisfies LanguageSettingsLogicResult
}
