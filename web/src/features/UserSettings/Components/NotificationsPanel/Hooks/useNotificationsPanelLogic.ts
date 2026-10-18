import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@rentnerkev/toasts'
import {
    getPersonalNotificationSettingsHandler,
    getPersonalNotificationStatusHandler,
    updatePersonalNotificationConfigurationHandler,
    testPersonalNotificationChannelHandler,
} from '@/features/UserSettings/Notifications/middleware.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    Channel,
    ChannelEditorState,
    ChannelInput,
    NotificationsPanelProps,
} from '../Types/notifications-panel.types.ts'

function channelInput(channel: Channel): ChannelInput {
    return {
        id: channel.id,
        name: channel.name,
        kind: channel.kind,
        enabled: channel.enabled,
        events: [...channel.events],
        minimumSeverity: channel.minimumSeverity,
        thresholdSeconds: channel.thresholdSeconds,
        recovery: channel.recovery,
    }
}

export default function useNotificationsPanelLogic({ user, active }: NotificationsPanelProps) {
    const { t } = useTranslationStore()
    const client = useQueryClient()
    const queryKey = ['personal-notifications', user.id] as const
    const settings = useQuery({
        queryKey: [...queryKey, 'settings'],
        queryFn: () => getPersonalNotificationSettingsHandler(),
        enabled: active,
    })
    const status = useQuery({
        queryKey: [...queryKey, 'status'],
        queryFn: () => getPersonalNotificationStatusHandler(),
        enabled: active,
    })
    const [editor, setEditor] = useState<ChannelEditorState | null>(null)
    const [deleting, setDeleting] = useState<Channel | null>(null)
    const lastError = useRef<unknown>(null)
    const error = settings.error ?? status.error
    useEffect(() => {
        if (error && lastError.current !== error) {
            lastError.current = error
            toast.error(t('account.notifications.loadFailed'), { title: t('toast.titles.error') })
        }
    }, [error, t])
    const mutation = useMutation({
        mutationFn: (data: {
            channels: ChannelInput[]
            expectedRevision: number
            resumeDelivery?: boolean
        }) => updatePersonalNotificationConfigurationHandler({ data }),
    })
    const testing = useMutation({
        mutationFn: (channel: Channel) =>
            testPersonalNotificationChannelHandler({
                data: { channelId: channel.id, expectedRevision: channel.revision },
            }),
        onSuccess: async (result) => {
            if (!result.success) toast.error(t(result.message), { title: t('toast.titles.error') })
            else if (!result.value.success)
                toast.error(t(`account.notifications.errors.${result.value.code}`), {
                    title: t('toast.titles.error'),
                })
            else
                toast.success(t('account.notifications.testSent'), {
                    title: t('toast.titles.success'),
                })
            await client.invalidateQueries({ queryKey })
        },
        onError: () =>
            toast.error(t('account.notifications.actionFailed'), {
                title: t('toast.titles.error'),
            }),
    })
    async function update(
        channels: ChannelInput[],
        expectedRevision: number,
        resumeDelivery = false,
    ) {
        if (mutation.isPending) return false
        try {
            const result = await mutation.mutateAsync({
                channels,
                expectedRevision,
                ...(resumeDelivery ? { resumeDelivery: true } : {}),
            })
            if (!result.success) {
                toast.error(
                    t(
                        'code' in result && result.code === 'configuration_conflict'
                            ? 'account.notifications.conflict'
                            : result.message,
                    ),
                    { title: t('toast.titles.error') },
                )
                await client.invalidateQueries({ queryKey })
                return false
            }
            client.setQueryData([...queryKey, 'settings'], result.value)
            toast.success(t('account.notifications.saved'), { title: t('toast.titles.success') })
            await client.invalidateQueries({ queryKey })
            return true
        } catch {
            toast.error(t('account.notifications.actionFailed'), { title: t('toast.titles.error') })
            return false
        }
    }
    const configuration = settings.data?.configuration
    const channels = configuration?.channels ?? []
    const pending = mutation.isPending || testing.isPending
    return {
        state: {
            settings: settings.data,
            status: status.data,
            loading: settings.isPending,
            editor,
            deleting,
            pending,
            testBlocked: !configuration?.enabled || configuration.pausedAfterRestore,
            failed: settings.isError,
        },
        handler: {
            handleEdit: (channel: Channel | null) =>
                configuration && setEditor({ channel, revision: configuration.revision, channels }),
            handleClose: () => !pending && setEditor(null),
            handleSave: async (channel: ChannelInput, snapshot: ChannelEditorState) => {
                const next = snapshot.channels
                    .filter((item) => item.id !== channel.id)
                    .map(channelInput)
                const success = await update([...next, channel], snapshot.revision)
                if (success) setEditor(null)
                return success
            },
            handleToggle: (channel: Channel) =>
                configuration &&
                update(
                    channels.map((item) => ({
                        ...channelInput(item),
                        enabled: item.id === channel.id ? !item.enabled : item.enabled,
                    })),
                    configuration.revision,
                ),
            handleTest: (channel: Channel) => testing.mutate(channel),
            handleDelete: () => setDeleting(null),
            handleRequestDelete: setDeleting,
            handleConfirmDelete: async () => {
                if (
                    configuration &&
                    deleting &&
                    (await update(
                        channels.filter((item) => item.id !== deleting.id).map(channelInput),
                        configuration.revision,
                    ))
                )
                    setDeleting(null)
            },
            handleResume: () =>
                configuration && update(channels.map(channelInput), configuration.revision, true),
        },
    }
}
