import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useNotificationsPanelLogic from './Hooks/useNotificationsPanelLogic.ts'
import ChannelEditor from './Components/ChannelEditor.tsx'
import DeliveryTable from './Components/DeliveryTable.tsx'
import type { NotificationsPanelProps } from './Types/notifications-panel.types.ts'

export default function NotificationsPanel(props: NotificationsPanelProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useNotificationsPanelLogic(props)
    return (
        <div className="grid gap-4">
            <section className="grid gap-4 rounded-2xl border border-border bg-surface p-5 shadow-surface">
                <div>
                    <h2 className="text-lg font-extrabold text-ink">
                        {t('account.notifications.title')}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                        {t('account.notifications.description')}
                    </p>
                </div>
                {state.loading ? <p className="text-sm text-muted">{t('common.loading')}</p> : null}
                {state.failed ? (
                    <p className="text-sm text-muted">{t('account.notifications.unavailable')}</p>
                ) : null}
                {state.settings ? (
                    <>
                        {state.testBlocked ? (
                            <div className="rounded-xl border border-border-strong bg-surface-raised p-3 text-sm text-muted">
                                <p>
                                    {t(
                                        state.settings.configuration.pausedAfterRestore
                                            ? 'account.notifications.paused'
                                            : 'account.notifications.runtimeOff',
                                    )}
                                </p>
                                {state.settings.canResumeDelivery ? (
                                    <button
                                        type="button"
                                        disabled={state.pending}
                                        className={buttonClassName('secondary', 'mt-2')}
                                        onClick={() => void handler.handleResume()}
                                    >
                                        {t('account.notifications.resume')}
                                    </button>
                                ) : (
                                    <p>{t('account.notifications.contactAdmin')}</p>
                                )}
                            </div>
                        ) : null}
                        {!state.settings.smtpConfigured ? (
                            <p className="text-sm text-muted">
                                {t('account.notifications.smtpMissing')}
                            </p>
                        ) : null}
                        <div className="grid gap-3">
                            {state.settings.configuration.channels.map((channel) => (
                                <article
                                    key={channel.id}
                                    className="grid gap-3 rounded-xl border border-border p-4"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <h3 className="font-extrabold text-ink">
                                                {channel.name}
                                            </h3>
                                            <p className="text-sm text-muted">
                                                {t(`account.notifications.${channel.kind}`)} ·{' '}
                                                {t(
                                                    channel.enabled
                                                        ? 'account.notifications.enabled'
                                                        : 'account.notifications.disabled',
                                                )}
                                            </p>
                                        </div>
                                        <OptionToggle
                                            label={t('account.notifications.enabled')}
                                            checked={channel.enabled}
                                            disabled={state.pending}
                                            onChange={() => void handler.handleToggle(channel)}
                                        />
                                    </div>
                                    <p className="text-sm text-muted">
                                        {channel.events
                                            .map((event) =>
                                                t(`account.notifications.categories.${event}`),
                                            )
                                            .join(' · ')}
                                    </p>
                                    <p className="text-sm text-muted">
                                        {t(
                                            channel.destinationConfigured
                                                ? 'account.notifications.destinationSaved'
                                                : 'account.notifications.destinationMissing',
                                        )}
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={state.pending}
                                            className={buttonClassName('secondary')}
                                            onClick={() => handler.handleEdit(channel)}
                                        >
                                            {t('account.notifications.edit')}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={
                                                state.pending ||
                                                state.testBlocked ||
                                                !channel.enabled ||
                                                !channel.destinationConfigured ||
                                                (channel.kind === 'email' &&
                                                    !state.settings?.smtpConfigured)
                                            }
                                            className={buttonClassName('secondary')}
                                            onClick={() => handler.handleTest(channel)}
                                        >
                                            {t('account.notifications.test')}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={state.pending}
                                            className={buttonClassName('danger')}
                                            onClick={() => handler.handleRequestDelete(channel)}
                                        >
                                            {t('account.notifications.delete')}
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                        {state.settings.allowedCategories.length ? (
                            <button
                                type="button"
                                disabled={state.pending}
                                className={buttonClassName('primary', 'justify-self-start')}
                                onClick={() => handler.handleEdit(null)}
                            >
                                {t('account.notifications.create')}
                            </button>
                        ) : (
                            <p className="text-sm text-muted">
                                {t('account.notifications.noCategories')}
                            </p>
                        )}
                    </>
                ) : null}
            </section>
            {state.status && state.settings ? (
                <DeliveryTable
                    status={state.status}
                    channels={state.settings.configuration.channels}
                />
            ) : null}
            {state.editor && state.settings ? (
                <ChannelEditor
                    editor={state.editor}
                    settings={state.settings}
                    email={props.user.email}
                    pending={state.pending}
                    onClose={handler.handleClose}
                    onSave={handler.handleSave}
                />
            ) : null}
            <ConfirmDialog
                open={!!state.deleting}
                onOpenChange={handler.handleDelete}
                destructive
                isPending={state.pending}
                onConfirm={handler.handleConfirmDelete}
                title={t('account.notifications.deleteTitle')}
                description={t('account.notifications.deleteDescription', {
                    name: state.deleting?.name ?? '',
                })}
                confirmLabel={t('account.notifications.delete')}
            />
        </div>
    )
}
