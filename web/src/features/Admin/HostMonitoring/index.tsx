import { NumberInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { Modal } from '@/shared/Modal/index.tsx'
import OptionToggle from '@/shared/Forms/OptionToggle.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import HostAvailabilityBadge from './Components/HostAvailabilityBadge.tsx'
import MonitoringOverview from './Components/MonitoringOverview.tsx'
import useHostMonitoringDialogLogic from './Hooks/useHostMonitoringDialogLogic.ts'
import type { HostMonitoringDialogProps } from './Types/host-monitoring-dialog.types.ts'

export default function HostMonitoringDialog(props: HostMonitoringDialogProps) {
    const { state, handler, form } = useHostMonitoringDialogLogic(props)
    const { t } = useTranslationStore()
    return (
        <Modal
            open={props.open}
            onOpenChange={handler.handleOpenChange}
            closeDisabled={state.pending || state.dirty}
            title={t('admin.hostMonitoring.title')}
            description={props.host.domains.join(', ')}
            size="xl"
            fixedHeight
            navigation={
                <div
                    role="tablist"
                    aria-label={t('admin.hostMonitoring.title')}
                    className="flex gap-1 border-b border-border p-2"
                >
                    {(['overview', 'settings'] as const).map((tab) => (
                        <button
                            key={tab}
                            id={`${state.id}-tab-${tab}`}
                            type="button"
                            role="tab"
                            aria-selected={state.tab === tab}
                            aria-controls={`${state.id}-panel-${tab}`}
                            tabIndex={state.tab === tab ? 0 : -1}
                            onClick={() => handler.handleTab(tab)}
                            onKeyDown={handler.handleTabKey}
                            className={`min-h-10 flex-1 rounded-lg px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-accent-ring ${state.tab === tab ? 'bg-accent-muted text-accent-ring' : 'text-muted hover:bg-surface-hover'}`}
                        >
                            {t(`admin.hostMonitoring.${tab}`)}
                        </button>
                    ))}
                </div>
            }
            footer={
                <>
                    {state.dirty ? (
                        <>
                            <span className="mr-auto text-xs text-muted">
                                {t('admin.hostMonitoring.dirty')}
                            </span>
                            <button
                                type="button"
                                className={buttonClassName('secondary')}
                                disabled={state.pending}
                                onClick={handler.handleDiscard}
                            >
                                {t('admin.hostMonitoring.discard')}
                            </button>
                        </>
                    ) : null}
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={state.pending || state.dirty}
                        onClick={() => handler.handleOpenChange(false)}
                    >
                        {t('admin.hostMonitoring.close')}
                    </button>
                    {state.canUpdate && state.tab === 'settings' ? (
                        <button
                            type="submit"
                            form={`${state.id}-form`}
                            className={buttonClassName('primary')}
                            disabled={
                                state.pending ||
                                !state.ready ||
                                !state.dirty ||
                                !state.valid ||
                                state.conflict
                            }
                            aria-busy={state.pending}
                        >
                            {t('admin.hostMonitoring.save')}
                        </button>
                    ) : null}
                </>
            }
        >
            <div className="grid min-w-0 gap-4">
                <p className="m-0 border-l-2 border-accent-border pl-3 text-sm leading-relaxed text-muted">
                    {t('admin.hostMonitoring.observationPoint')}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <HostAvailabilityBadge
                        availability={
                            state.loading
                                ? 'loading'
                                : state.error
                                  ? 'unavailable'
                                  : (state.policy?.availability ?? 'disabled')
                        }
                    />
                    <span className="text-xs text-muted">
                        {t(
                            `admin.hostMonitoring.${props.host.enabled ? 'hostEnabled' : 'hostDisabled'}`,
                        )}
                    </span>
                </div>
                {!state.canView ? (
                    <p role="alert" className="text-sm text-danger-text">
                        {t('admin.hostMonitoring.permissionDenied')}
                    </p>
                ) : state.loading ? (
                    <output className="text-sm text-muted">
                        {t('admin.hostMonitoring.loading')}
                    </output>
                ) : state.error ? (
                    <div role="alert" className="grid gap-3 text-sm text-danger-text">
                        <p>{t('admin.hostMonitoring.loadError')}</p>
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={handler.handleRetry}
                        >
                            {t('admin.hostMonitoring.retry')}
                        </button>
                    </div>
                ) : (
                    <>
                        <section
                            role="tabpanel"
                            hidden={state.tab !== 'overview'}
                            id={`${state.id}-panel-overview`}
                            aria-labelledby={`${state.id}-tab-overview`}
                            tabIndex={0}
                        >
                            <MonitoringOverview state={state} handler={handler} />
                        </section>
                        <section
                            role="tabpanel"
                            hidden={state.tab !== 'settings'}
                            id={`${state.id}-panel-settings`}
                            aria-labelledby={`${state.id}-tab-settings`}
                            tabIndex={0}
                        >
                            {!state.policy ? (
                                <p className="text-sm text-muted">
                                    {t('admin.hostMonitoring.noPolicy')}
                                </p>
                            ) : null}
                            {state.domains.length === 0 ? (
                                <p role="alert" className="text-sm text-danger-text">
                                    {t('admin.hostMonitoring.noDomains')}
                                </p>
                            ) : null}
                            {state.policy?.availability === 'domain_removed' ? (
                                <p role="alert" className="text-sm text-danger-text">
                                    {t('admin.hostMonitoring.domainRemoved')}
                                </p>
                            ) : null}
                            {state.canUpdate ? (
                                <form
                                    id={`${state.id}-form`}
                                    onSubmit={handler.handleSubmit}
                                    className="grid gap-5"
                                >
                                    <form.Field name="enabled">
                                        {(field) => (
                                            <OptionToggle
                                                name={field.name}
                                                label={t('admin.hostMonitoring.enabled')}
                                                checked={field.state.value}
                                                onChange={(event) =>
                                                    field.handleChange(event.target.checked)
                                                }
                                                onBlur={field.handleBlur}
                                                disabled={
                                                    !state.ready ||
                                                    state.pending ||
                                                    state.domains.length === 0
                                                }
                                            />
                                        )}
                                    </form.Field>
                                    <form.Field name="domain">
                                        {(field) => (
                                            <CustomSelect
                                                label={t('admin.hostMonitoring.domain')}
                                                aria-label={t('admin.hostMonitoring.domain')}
                                                options={[
                                                    ...(state.policy &&
                                                    !state.domains.some(
                                                        (domain) =>
                                                            domain.value ===
                                                            state.policy?.settings.domain,
                                                    )
                                                        ? [
                                                              {
                                                                  value: state.policy.settings
                                                                      .domain,
                                                                  label: state.policy.settings
                                                                      .domain,
                                                              },
                                                          ]
                                                        : []),
                                                    ...state.domains,
                                                ]}
                                                value={field.state.value || null}
                                                onValueChange={field.handleChange}
                                                onBlur={field.handleBlur}
                                                disabled={
                                                    !state.ready ||
                                                    state.pending ||
                                                    state.domains.length === 0
                                                }
                                            />
                                        )}
                                    </form.Field>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        {state.numericFields.map((setting) => (
                                            <form.Field key={setting.name} name={setting.name}>
                                                {(field) => (
                                                    <NumberInput
                                                        name={field.name}
                                                        label={t(
                                                            `admin.hostMonitoring.${setting.name}`,
                                                        )}
                                                        value={String(field.state.value)}
                                                        onValueChange={(value) =>
                                                            field.handleChange(Number(value))
                                                        }
                                                        onBlur={field.handleBlur}
                                                        minValue={setting.min}
                                                        maxValue={setting.max}
                                                        disabled={!state.ready || state.pending}
                                                        locale={state.locale}
                                                        validationMode="external"
                                                        aria-invalid={
                                                            field.state.meta.errors.length > 0
                                                        }
                                                    />
                                                )}
                                            </form.Field>
                                        ))}
                                    </div>
                                    {!state.valid && state.dirty ? (
                                        <p role="alert" className="text-sm text-danger-text">
                                            {t('admin.hostMonitoring.invalid')}
                                        </p>
                                    ) : null}
                                </form>
                            ) : state.policy ? (
                                <dl className="grid grid-cols-2 gap-3 text-sm">
                                    {state.numericFields.map((setting) => (
                                        <div key={setting.name}>
                                            <dt className="text-muted">
                                                {t(`admin.hostMonitoring.${setting.name}`)}
                                            </dt>
                                            <dd className="m-0 font-mono">
                                                {state.policy?.settings[setting.name]}
                                            </dd>
                                        </div>
                                    ))}
                                    <div>
                                        <dt className="text-muted">
                                            {t('admin.hostMonitoring.domain')}
                                        </dt>
                                        <dd className="m-0 break-all">
                                            {state.policy.settings.domain}
                                        </dd>
                                    </div>
                                </dl>
                            ) : null}
                            {state.notice ? (
                                <output className="text-sm text-muted">{state.notice}</output>
                            ) : null}
                            {state.conflict ? (
                                <button
                                    type="button"
                                    className={buttonClassName('secondary')}
                                    disabled={state.pending}
                                    onClick={handler.handleReload}
                                >
                                    {t('admin.hostMonitoring.reload')}
                                </button>
                            ) : null}
                        </section>
                    </>
                )}
            </div>
        </Modal>
    )
}
