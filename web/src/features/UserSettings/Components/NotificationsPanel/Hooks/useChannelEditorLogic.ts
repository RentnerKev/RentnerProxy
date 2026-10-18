import { useId, useState, type FormEvent } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { toast } from '@rentnerkev/toasts'
import { updatePersonalNotificationConfigurationSchema } from '@/lib/Notifications/validation.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    ChannelEditorProps,
    ChannelFormValues,
    ChannelInput,
} from '../Types/notifications-panel.types.ts'

export default function useChannelEditorLogic(props: ChannelEditorProps) {
    const { t, locale, language } = useTranslationStore()
    const formId = useId()
    const [id] = useState(() => props.editor.channel?.id ?? crypto.randomUUID())
    const [defaults] = useState<ChannelFormValues>(() => ({
        name: props.editor.channel?.name ?? '',
        kind: props.editor.channel?.kind ?? 'email',
        enabled: props.editor.channel?.enabled ?? true,
        events: [...(props.editor.channel?.events ?? props.settings.allowedCategories)],
        minimumSeverity: props.editor.channel?.minimumSeverity ?? 'warning',
        thresholdSeconds: String(props.editor.channel?.thresholdSeconds ?? 0),
        recovery: props.editor.channel?.recovery ?? true,
        replaceDestination: !props.editor.channel,
        recipients: props.editor.channel ? '' : props.email,
        url: '',
        token: '',
        cidrs: '',
    }))
    const form = useForm({
        defaultValues: defaults,
        onSubmit: async ({ value }) => {
            if (props.pending) return
            const thresholdSeconds = Number(value.thresholdSeconds)
            if (
                !value.name.trim() ||
                !value.events.length ||
                !Number.isInteger(thresholdSeconds) ||
                thresholdSeconds < 0 ||
                value.events.some(
                    (category) => !props.settings.allowedCategories.includes(category),
                )
            ) {
                toast.error(t('account.notifications.invalidInput'))
                return
            }
            const channel: ChannelInput = {
                id,
                name: value.name.trim(),
                kind: value.kind,
                enabled: value.enabled,
                events: value.events,
                minimumSeverity: value.minimumSeverity,
                thresholdSeconds,
                recovery: value.recovery,
            }
            if (value.replaceDestination) {
                if (value.kind === 'email') {
                    const recipients = value.recipients
                        .split(/[;,\n]/u)
                        .map((item) => item.trim())
                        .filter(Boolean)
                    if (
                        !recipients.length ||
                        recipients.some((item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(item))
                    ) {
                        toast.error(t('account.notifications.invalidInput'))
                        return
                    }
                    channel.destination = { kind: 'email', recipients }
                } else {
                    try {
                        const url = new URL(value.url)
                        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error()
                    } catch {
                        toast.error(t('account.notifications.invalidInput'))
                        return
                    }
                    channel.destination = {
                        kind: 'webhook',
                        url: value.url.trim(),
                        authorizationToken: value.token.trim() || null,
                        allowedPrivateCidrs: props.settings.canUsePrivateDestinations
                            ? value.cidrs.split(/[,;\s]+/u).filter(Boolean)
                            : [],
                    }
                }
            }
            const parsed = updatePersonalNotificationConfigurationSchema.shape.channels.safeParse([
                channel,
            ])
            if (!parsed.success) {
                toast.error(t('account.notifications.invalidInput'))
                return
            }
            await props.onSave(parsed.data[0]!, props.editor)
        },
    })
    const values = useStore(form.store, (state) => state.values)
    return {
        form,
        state: {
            formId,
            values,
            locale,
            selectLocale: language === 'de' ? ('de' as const) : ('en' as const),
            editing: !!props.editor.channel,
            categoryOptions: props.settings.allowedCategories.map((value) => ({
                value,
                label: t(`account.notifications.categories.${value}`),
            })),
            kindOptions: [
                { value: 'email', label: t('account.notifications.email') },
                { value: 'webhook', label: t('account.notifications.webhook') },
            ] as const,
            severityOptions: [
                { value: 'warning', label: t('account.notifications.severities.warning') },
                { value: 'error', label: t('account.notifications.severities.error') },
                { value: 'critical', label: t('account.notifications.severities.critical') },
            ] as const,
        },
        handler: {
            handleSubmit: (event: FormEvent) => {
                event.preventDefault()
                void form.handleSubmit()
            },
        },
    }
}
