import { useEffect, useRef } from 'react'
import { toast } from '@rentnerkev/toasts'
import getFieldErrorMessage from '@/lib/Forms/fieldErrors.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { FieldErrorProps } from '../Types/form-component-props.types.ts'

/** Announces opted-in form errors without repeating them on unrelated form renders. */
export default function useFieldErrorLogic({
    errors,
    id,
    feedback,
    validationEpoch,
}: FieldErrorProps) {
    const { authenticated, t } = useTranslationStore()
    const message = getFieldErrorMessage(errors, authenticated ? t : undefined)
    const reported = useRef<{ message: string; validationEpoch: number | undefined } | null>(null)
    useEffect(() => {
        // An explicit zero epoch waits for validation to finish before announcing its result.
        if (feedback !== 'toast' || !message || validationEpoch === 0) {
            reported.current = null
            return
        }
        if (
            reported.current?.message === message &&
            reported.current.validationEpoch === validationEpoch
        )
            return
        reported.current = { message, validationEpoch }
        toast.error(message, {
            title: t('toast.titles.error'),
            dedupeKey: `field-validation:${id}:${message}`,
            dedupeWindow: 1_000,
        })
    }, [feedback, id, message, validationEpoch, t])
    return { state: { message } }
}
