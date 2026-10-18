import { TextInput } from '@rentnerkev/inputs'
import { Modal } from '@/shared/Modal/index.tsx'
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
                    <button
                        type="button"
                        onClick={handler.close}
                        disabled={state.pending}
                        className="min-h-12 rounded-xl border border-danger-text bg-danger-bg px-4 py-3 text-sm font-extrabold text-danger-text disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        disabled={state.pending || !state.canSave}
                        className="min-h-12 rounded-xl bg-accent px-4 py-3 text-sm font-extrabold text-accent-foreground disabled:opacity-50"
                    >
                        {t(
                            state.pending
                                ? 'common.working'
                                : 'admin.dockerDiscovery.connection.save',
                        )}
                    </button>
                </>
            }
        >
            <form id={state.formId} onSubmit={handler.submit} noValidate className="grid gap-5">
                <form.Field name="endpoint">
                    {(field) => (
                        <TextInput
                            id={`${state.formId}-endpoint`}
                            name={field.name}
                            label={t('admin.dockerDiscovery.connection.endpoint')}
                            description={t('admin.dockerDiscovery.connection.endpointHint')}
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
