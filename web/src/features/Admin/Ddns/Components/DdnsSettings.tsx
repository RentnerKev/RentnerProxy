import { NumberInput } from '@rentnerkev/inputs'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import useDdnsSettingsLogic from '../Hooks/useDdnsSettingsLogic.ts'
import type { DdnsSettingsProps } from '../Types/ddns-editor.types.ts'
export default function DdnsSettings(props: DdnsSettingsProps) {
    const { t } = useTranslationStore()
    const { state, handler, form } = useDdnsSettingsLogic(props)
    return (
        <Modal
            open
            onOpenChange={handler.close}
            closeDisabled={state.pending}
            title={t('admin.ddns.form.title')}
            description={t('admin.ddns.settings.description')}
            footer={
                <>
                    <button
                        type="button"
                        onClick={handler.close}
                        disabled={state.pending}
                        className="h-12 rounded-xl border border-danger-text bg-danger-bg px-4 text-sm font-extrabold text-danger-text disabled:opacity-50"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="submit"
                        form={state.formId}
                        disabled={state.locked || state.stale}
                        className="h-12 rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground disabled:opacity-50"
                    >
                        {t(state.pending ? 'common.working' : 'common.save')}
                    </button>
                </>
            }
        >
            <form id={state.formId} onSubmit={handler.submit} className="grid gap-5">
                <form.Field name="intervalSeconds">
                    {(field) => (
                        <NumberInput
                            name="intervalSeconds"
                            label={t('admin.ddns.form.interval')}
                            description={t('admin.ddns.form.intervalHint')}
                            value={String(field.state.value)}
                            onValueChange={(value) => field.handleChange(Number(value))}
                            onBlur={field.handleBlur}
                            minValue={60}
                            maxValue={86400}
                            disabled={state.pending}
                            locale={state.locale}
                            validationMode="external"
                        />
                    )}
                </form.Field>
                <form.Field name="updateOnStart">
                    {(field) => (
                        <OptionToggle
                            label={t('admin.ddns.form.updateOnStart')}
                            name="updateOnStart"
                            checked={field.state.value}
                            onChange={(event) => field.handleChange(event.target.checked)}
                            onBlur={field.handleBlur}
                            disabled={state.pending}
                        />
                    )}
                </form.Field>
            </form>
        </Modal>
    )
}
