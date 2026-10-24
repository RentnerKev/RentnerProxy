import { ModalCancelButton, ModalSaveButton } from '@/shared/Modal/Components/ModalActions.tsx'
import { TextInput } from '@rentnerkev/inputs'
import { RotateCw } from 'lucide-react'
import { Modal } from '@/shared/Modal/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useDiscoveryConnectionLogic from './Hooks/useDiscoveryConnectionLogic.ts'
import type { DiscoveryConnectionProps } from '../../Types/discovery-ui.types.ts'

export default function DiscoveryConnection(props: DiscoveryConnectionProps) {
    const { t } = useTranslationStore()
    const { state, handler, form } = useDiscoveryConnectionLogic(props)
    return (
        <Modal
            open
            onOpenChange={handler.close}
            closeDisabled={state.pending}
            title={t('admin.dockerDiscovery.connection.title')}
            description={t('admin.dockerDiscovery.connection.description')}
            footer={
                <>
                    <ModalCancelButton
                        type="button"
                        onClick={handler.close}
                        disabled={state.pending}
                    />
                    <ModalSaveButton
                        form={state.formId}
                        isPending={state.pending}
                        disabled={state.pending || !state.canSave}
                    />
                </>
            }
        >
            <form id={state.formId} onSubmit={handler.submit} noValidate className="grid gap-5">
                <fieldset
                    aria-label={t('admin.dockerDiscovery.runtime.title')}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-3"
                >
                    <output className="rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-bold text-ink-soft">
                        {t(`admin.dockerDiscovery.connector.${props.runtime.status}`)}
                    </output>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            disabled={!state.canToggleSynchronization}
                            onClick={handler.toggleSynchronization}
                            className={buttonClassName('secondary')}
                        >
                            {t(
                                props.runtime.needsActivation
                                    ? 'admin.dockerDiscovery.actions.enable'
                                    : 'admin.dockerDiscovery.actions.disable',
                            )}
                        </button>
                        {props.runtime.showRetry && props.runtime.canRetry ? (
                            <button
                                type="button"
                                onClick={handler.retry}
                                disabled={state.pending || props.runtime.locked}
                                className={buttonClassName('secondary')}
                            >
                                <RotateCw size={16} aria-hidden="true" />
                                {t('admin.dockerDiscovery.actions.retry')}
                            </button>
                        ) : null}
                    </div>
                    {props.runtime.status === 'paused' ? (
                        <p className="m-0 w-full text-sm text-muted">
                            {t('admin.dockerDiscovery.runtime.restorePaused')}
                        </p>
                    ) : null}
                    {props.runtime.appliedStatus ? (
                        <p className="m-0 w-full text-xs text-muted">
                            {t(`admin.dockerDiscovery.applied.${props.runtime.appliedStatus}`)}
                        </p>
                    ) : null}
                </fieldset>
                <form.Field name="endpoint">
                    {(field) => (
                        <TextInput
                            id={`${state.formId}-endpoint`}
                            name={field.name}
                            label={t('admin.dockerDiscovery.connection.endpoint')}
                            inputMode="url"
                            autoComplete="off"
                            required
                            maxLength={512}
                            placeholder={t('admin.dockerDiscovery.connection.endpointPlaceholder')}
                            value={field.state.value}
                            onValueChange={field.handleChange}
                            onBlur={field.handleBlur}
                            disabled={state.pending}
                            validationMode="external"
                        />
                    )}
                </form.Field>
                <button
                    type="button"
                    onClick={() => void handler.test()}
                    disabled={state.pending}
                    className="min-h-10 justify-self-start rounded-xl border border-border bg-surface-raised px-4 text-sm font-bold text-ink-soft hover:bg-surface-hover disabled:opacity-50"
                >
                    {t(state.testing ? 'common.working' : 'admin.dockerDiscovery.connection.test')}
                </button>
                {props.context.connected ? (
                    <button
                        type="button"
                        onClick={handler.disconnect}
                        disabled={state.pending}
                        className="min-h-9 justify-self-start rounded-lg border border-danger-text bg-danger-bg px-3 text-xs font-bold text-danger-text disabled:opacity-50"
                    >
                        {t('admin.dockerDiscovery.actions.disconnect')}
                    </button>
                ) : null}
                {props.context.restorePaused ? (
                    <form.Field name="acknowledgeRestore">
                        {(field) => (
                            <OptionToggle
                                name={field.name}
                                label={t('admin.dockerDiscovery.connection.acknowledgeRestore')}
                                checked={field.state.value}
                                onChange={(event) => field.handleChange(event.target.checked)}
                                onBlur={field.handleBlur}
                                disabled={state.pending}
                            />
                        )}
                    </form.Field>
                ) : null}
            </form>
        </Modal>
    )
}
