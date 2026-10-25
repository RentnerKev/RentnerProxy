import { ModalCancelButton, ModalSaveButton } from '@/shared/Modal/Components/ModalActions.tsx'
import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import { Plus, X } from 'lucide-react'
import { Modal } from '@/shared/Modal/index.tsx'
import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useDdnsRecordEditorLogic from '../Hooks/useDdnsRecordEditorLogic.ts'
import type { DdnsRecordEditorProps } from '../Types/ddns-editor.types.ts'

export default function DdnsRecordEditor(props: DdnsRecordEditorProps) {
    const { state, handler, form } = useDdnsRecordEditorLogic(props)
    const { t } = useTranslationStore()
    return (
        <Modal
            open
            onOpenChange={handler.close}
            closeDisabled={state.pending}
            title={t(state.editing ? 'admin.ddns.editor.editTitle' : 'admin.ddns.editor.addTitle')}
            description={t('admin.ddns.editor.description')}
            footer={
                <>
                    <ModalCancelButton
                        type="button"
                        disabled={state.pending}
                        onClick={handler.close}
                    />
                    <ModalSaveButton
                        form={state.formId}
                        isPending={state.pending}
                        disabled={state.locked || state.stale}
                    />
                </>
            }
        >
            <form id={state.formId} onSubmit={handler.submit} className="grid gap-5">
                {state.operationUnavailable ? (
                    <p role="alert" className="text-sm text-danger-text">
                        {t('admin.dnsConnections.providers.unavailable')}
                    </p>
                ) : null}
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    <CustomSelect
                        value={state.connectionId || null}
                        options={state.connectionOptions}
                        onValueChange={handler.changeConnection}
                        label={t('admin.ddns.form.connection')}
                        placeholder={t('admin.ddns.form.chooseConnection')}
                        disabled={state.pending || !state.canChooseConnection}
                        locale={state.selectLocale}
                    />
                    <CustomSelect
                        value={state.zoneId}
                        options={state.zoneOptions}
                        onValueChange={handler.changeZone}
                        label={t('admin.ddns.form.zone')}
                        disabled={
                            state.pending || !state.connectionId || !state.canChooseConnection
                        }
                        locale={state.selectLocale}
                    />
                </div>
                {!state.connectionOptions.length ? (
                    <p className="text-sm text-muted">
                        {t('admin.ddns.form.noConnections')}{' '}
                        <a href="/dns-connections" className="font-bold text-accent-ring underline">
                            {t('shell.dnsConnections')}
                        </a>
                    </p>
                ) : null}
                {!state.recordTypeAvailable && state.savedRecordType ? (
                    <p className="text-sm text-muted">
                        {t('admin.ddns.editor.recordType')}: {state.savedRecordType}
                    </p>
                ) : null}
                <form.Field name="recordType">
                    {(field) => (
                        <CustomSelect
                            value={field.state.value}
                            options={state.recordTypeOptions}
                            onValueChange={field.handleChange}
                            label={t('admin.ddns.editor.recordType')}
                            disabled={state.pending}
                            locale={state.selectLocale}
                        />
                    )}
                </form.Field>
                <fieldset disabled={state.pending} className="grid min-w-0 gap-3">
                    <legend className="mb-2 text-sm font-bold text-ink-soft">
                        {t('admin.ddns.form.domains')}
                    </legend>
                    {state.domains.map((domain, index) => (
                        <div key={domain.id} className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <TextInput
                                    ref={(input) => handler.captureInput(domain.id, input)}
                                    value={domain.value}
                                    onValueChange={(value) =>
                                        handler.changeDomain(domain.id, value)
                                    }
                                    onKeyDown={(event) => handler.domainKey(event, domain.id)}
                                    aria-label={t('admin.ddns.editor.domainLabel', {
                                        number: index + 1,
                                    })}
                                    name={`domain-${index}`}
                                    placeholder={t('admin.ddns.editor.placeholder')}
                                    autoComplete="off"
                                    spellCheck={false}
                                    maxLength={254}
                                    locale={state.locale}
                                />
                            </div>
                            {state.domains.length > 1 ? (
                                <button
                                    type="button"
                                    onClick={() => handler.removeDomain(domain.id)}
                                    aria-label={t('admin.ddns.editor.removeDomain', {
                                        number: index + 1,
                                    })}
                                    className="grid size-11 shrink-0 place-items-center rounded-xl text-danger-text hover:bg-danger-bg"
                                >
                                    <X aria-hidden="true" className="size-4" />
                                </button>
                            ) : null}
                        </div>
                    ))}
                    {!state.editing ? (
                        <button
                            type="button"
                            onClick={() => handler.addDomain()}
                            disabled={state.domains.length >= 100}
                            className="inline-flex min-h-10 items-center justify-self-start gap-2 rounded-lg px-2 text-sm font-bold text-accent-ring hover:bg-accent-muted disabled:opacity-50"
                        >
                            <Plus aria-hidden="true" className="size-4" />
                            {t('admin.ddns.editor.addDomain')}
                        </button>
                    ) : null}
                </fieldset>
                <div className="flex flex-wrap gap-2">
                    <form.Field name="proxied">
                        {(field) => (
                            <OptionToggle
                                label={t('admin.ddns.records.proxied')}
                                name="proxied"
                                checked={field.state.value}
                                onChange={(event) => field.handleChange(event.target.checked)}
                                disabled={state.pending || !state.proxyAvailable}
                                onBlur={field.handleBlur}
                            />
                        )}
                    </form.Field>
                    <form.Field name="enabled">
                        {(field) => (
                            <OptionToggle
                                label={t('admin.ddns.editor.enabled')}
                                name="targetEnabled"
                                checked={field.state.value}
                                onChange={(event) => field.handleChange(event.target.checked)}
                                disabled={state.pending}
                                onBlur={field.handleBlur}
                            />
                        )}
                    </form.Field>
                </div>
            </form>
        </Modal>
    )
}
