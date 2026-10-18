import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type {
    NotificationConfiguration,
    NotificationCategory,
    PersonalNotificationSettings,
    NotificationStatus,
} from '@/lib/Notifications/Types/notifications.types.ts'
import type { z } from 'zod'
import type { updatePersonalNotificationConfigurationSchema } from '@/lib/Notifications/validation.ts'

export type Channel = NotificationConfiguration['channels'][number]
export type ChannelInput = z.infer<
    typeof updatePersonalNotificationConfigurationSchema
>['channels'][number]
export interface NotificationsPanelProps {
    user: AuthenticatedUser
    active: boolean
}
export interface ChannelEditorState {
    channel: Channel | null
    revision: number
    channels: readonly Channel[]
}
export interface ChannelEditorProps {
    editor: ChannelEditorState
    settings: PersonalNotificationSettings
    email: string
    pending: boolean
    onClose: () => void
    onSave: (channel: ChannelInput, editor: ChannelEditorState) => Promise<boolean>
}
export interface DeliveryTableProps {
    status: NotificationStatus
    channels: readonly Channel[]
}
export type DeliveryRow = NotificationStatus['deliveries'][number] & {
    channelName: string
    incidentState: string
}
export interface ChannelFormValues {
    name: string
    kind: 'email' | 'webhook'
    enabled: boolean
    events: NotificationCategory[]
    minimumSeverity: 'warning' | 'error' | 'critical'
    thresholdSeconds: string
    recovery: boolean
    replaceDestination: boolean
    recipients: string
    url: string
    token: string
    cidrs: string
}
