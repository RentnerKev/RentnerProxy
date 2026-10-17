import { toast } from '@rentnerkev/toasts/toast'
import { useForm } from '@tanstack/react-form'
import { useId, useState, type FormEvent } from 'react'
import { ddnsDraftSchema } from '@/lib/Ddns/validation.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DdnsSettingsProps } from '../Types/ddns-editor.types.ts'
export default function useDdnsSettingsLogic(props: DdnsSettingsProps) {
    const formId = useId()
    const { t, locale } = useTranslationStore()
    const [defaults] = useState(props.draft)
    const form = useForm({
        defaultValues: defaults,
        onSubmit: async ({ value }) => {
            if (props.locked || props.stale) return
            const parsed = ddnsDraftSchema.safeParse(value)
            if (!parsed.success) {
                toast.error(
                    t(parsed.error.issues[0]?.message ?? 'admin.ddns.errors.invalid_input'),
                    { title: t('toast.titles.error') },
                )
                return
            }
            await props.onSave(parsed.data, props.revision)
        },
    })
    return {
        state: { formId, locale, pending: props.pending, stale: props.stale, locked: props.locked },
        form,
        handler: {
            close: () => {
                if (!props.pending) props.onClose()
            },
            submit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                void form.handleSubmit()
            },
        },
    }
}
