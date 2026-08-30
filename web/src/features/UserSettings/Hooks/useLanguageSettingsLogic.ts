import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'

import { AVAILABLE_LANGUAGES, FLAG_IMAGES, isAppLanguage } from '../../../config/language.config'
import useTranslationStore, {
    loadLanguageBootstrap,
    type AppLanguage,
} from '../../../language/useTranslationStore'
import { updateCurrentUserLanguageHandler } from '../server'

export default function useLanguageSettingsLogic() {
    const router = useRouter()
    const { language, setLanguage, t } = useTranslationStore()
    const [draftLanguage, setDraftLanguage] = useState<AppLanguage | null>(null)
    const saveInFlight = useRef(false)
    const selectedLanguage = draftLanguage ?? language
    const isDirty = selectedLanguage !== language
    const mutation = useMutation({
        mutationFn: async (nextLanguage: AppLanguage) => {
            // Keep the persisted preference and visible language unchanged if loading fails.
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
                void router.invalidate()
            }
        },
        onSettled: () => {
            saveInFlight.current = false
        },
    })
    const errorMessage = mutation.isError
        ? mutation.error instanceof Error && mutation.error.message === 'language.loadFailed'
            ? 'language.loadFailed'
            : 'language.saveFailed'
        : mutation.data && !mutation.data.success
          ? mutation.data.message
          : null

    return {
        state: {
            selectedLanguage,
            isDirty,
            isSaving: mutation.isPending,
            errorMessage,
            saved: mutation.isSuccess && mutation.data.success && !isDirty,
            options: AVAILABLE_LANGUAGES.map((value) => ({
                value,
                label: t(`language.names.${value}`),
                imageSrc: FLAG_IMAGES[value],
            })),
        },
        handler: {
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
            handleSave: () => {
                if (isDirty && !saveInFlight.current && !mutation.isPending) {
                    saveInFlight.current = true
                    mutation.mutate(selectedLanguage)
                }
            },
        },
    }
}
