import { useEffect } from 'react'
import { toast } from '@rentnerkev/toasts'
import getFieldErrorMessage from '@/lib/Forms/fieldErrors.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { FieldErrorProps } from '../Types/form-component-props.types.ts'

/** Announces opted-in form errors without repeating them on unrelated form renders. */
export default function useFieldErrorLogic({ errors, id, feedback }: FieldErrorProps) {
    const { authenticated, t } = useTranslationStore()
    const message = getFieldErrorMessage(errors, authenticated ? t : undefined)
    useEffect(() => {
        if (feedback !== 'toast' || !message) return
        toast.error(message, {
            title: t('toast.titles.error'),
            dedupeKey: `field-validation:${id}:${message}`,
            dedupeWindow: 1_000,
        })
    }, [feedback, id, message, t])
    return { state: { message } }
}
