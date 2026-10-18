import { PasswordInput, TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import { Modal } from '@/shared/Modal/index.tsx'
import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useChannelEditorLogic from '../Hooks/useChannelEditorLogic.ts'
import type { ChannelEditorProps } from '../Types/notifications-panel.types.ts'

export default function ChannelEditor(props: ChannelEditorProps) {
    const { t } = useTranslationStore()
    const { state, handler, form } = useChannelEditorLogic(props)
    return (
        <Modal
            open
            onOpenChange={props.onClose}
            closeDisabled={props.pending}
            title={t(state.editing ? 'account.notifications.edit' : 'account.notifications.create')}
            description={t('account.notifications.editorDescription')}
            footer={
                <>
                    <button
                        type="button"
                        className={buttonClassName('danger')}
                        disabled={props.pending}
                        onClick={props.onClose}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        className={buttonClassName('primary')}
                        disabled={props.pending}
                    >
                        {t(props.pending ? 'common.working' : 'common.save')}
                    </button>
                </>
            }
        >
            <form id={state.formId} onSubmit={handler.handleSubmit} className="grid gap-4">
                <fieldset disabled={props.pending} className="grid gap-4">
                    <form.Field name="name">
                        {(field) => (
                            <TextInput
                                label={t('account.notifications.name')}
                                required
                                value={field.state.value}
                                onValueChange={field.handleChange}
                                maxLength={80}
                                locale={state.locale}
                            />
                        )}
                    </form.Field>
                    <form.Field name="kind">
                        {(field) => (
                            <CustomSelect
                                label={t('account.notifications.kind')}
                                value={field.state.value}
                                options={state.kindOptions}
                                onValueChange={field.handleChange}
                                disabled={state.editing || props.pending}
                                locale={state.selectLocale}
                            />
                        )}
                    </form.Field>
                    <form.Field name="events">
                        {(field) => (
                            <CustomSelect
                                multiple
                                required
                                label={t('account.notifications.events')}
                                value={field.state.value}
                                options={state.categoryOptions}
                                onValueChange={field.handleChange}
                                locale={state.selectLocale}
                            />
                        )}
                    </form.Field>
                    <form.Field name="minimumSeverity">
                        {(field) => (
                            <CustomSelect
                                label={t('account.notifications.minimumSeverity')}
                                value={field.state.value}
                                options={state.severityOptions}
                                onValueChange={field.handleChange}
                                locale={state.selectLocale}
                            />
                        )}
                    </form.Field>
                    <form.Field name="thresholdSeconds">
                        {(field) => (
                            <TextInput
                                inputMode="numeric"
                                required
                                label={t('account.notifications.thresholdSeconds')}
                                value={field.state.value}
                                onValueChange={field.handleChange}
                                locale={state.locale}
                            />
                        )}
                    </form.Field>
                    <div className="flex flex-wrap gap-2">
                        <form.Field name="enabled">
                            {(field) => (
                                <OptionToggle
                                    label={t('account.notifications.enabled')}
                                    checked={field.state.value}
                                    onChange={(event) => field.handleChange(event.target.checked)}
                                />
                            )}
                        </form.Field>
                        <form.Field name="recovery">
                            {(field) => (
                                <OptionToggle
                                    label={t('account.notifications.recovery')}
                                    checked={field.state.value}
                                    onChange={(event) => field.handleChange(event.target.checked)}
                                />
                            )}
                        </form.Field>
                    </div>
                    {state.editing ? (
                        <>
                            <form.Field name="replaceDestination">
                                {(field) => (
                                    <OptionToggle
                                        label={t('account.notifications.replaceDestination')}
                                        checked={field.state.value}
                                        onChange={(event) =>
                                            field.handleChange(event.target.checked)
                                        }
                                    />
                                )}
                            </form.Field>
                            <p className="text-sm text-muted">
                                {t('account.notifications.keepDestination')}
                            </p>
                        </>
                    ) : null}
                    {state.values.replaceDestination ? (
                        state.values.kind === 'email' ? (
                            <form.Field name="recipients">
                                {(field) => (
                                    <TextInput
                                        label={t('account.notifications.recipients')}
                                        required
                                        value={field.state.value}
                                        onValueChange={field.handleChange}
                                        autoComplete="off"
                                        locale={state.locale}
                                    />
                                )}
                            </form.Field>
                        ) : (
                            <>
                                <form.Field name="url">
                                    {(field) => (
                                        <TextInput
                                            label={t('account.notifications.url')}
                                            required
                                            value={field.state.value}
                                            onValueChange={field.handleChange}
                                            autoComplete="off"
                                            locale={state.locale}
                                        />
                                    )}
                                </form.Field>
                                <form.Field name="token">
                                    {(field) => (
                                        <PasswordInput
                                            label={t('account.notifications.token')}
                                            value={field.state.value}
                                            onValueChange={field.handleChange}
                                            autoComplete="new-password"
                                            locale={state.locale}
                                        />
                                    )}
                                </form.Field>
                                <p className="text-sm text-muted">
                                    {t('account.notifications.tokenHint')}
                                </p>
                                {props.settings.canUsePrivateDestinations ? (
                                    <form.Field name="cidrs">
                                        {(field) => (
                                            <TextInput
                                                label={t('account.notifications.cidrs')}
                                                value={field.state.value}
                                                onValueChange={field.handleChange}
                                                locale={state.locale}
                                            />
                                        )}
                                    </form.Field>
                                ) : null}
                            </>
                        )
                    ) : null}
                </fieldset>
            </form>
        </Modal>
    )
}
