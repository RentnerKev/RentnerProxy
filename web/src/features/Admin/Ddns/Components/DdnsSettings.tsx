import { CheckboxInput, NumberInput, Textarea } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type useDdnsLogic from '../Hooks/useDdnsLogic.ts'

export default function DdnsSettings({ state, handler, form }: ReturnType<typeof useDdnsLogic>) {
    const { t, locale, language } = useTranslationStore()
    const selectLocale =
        language === 'de' || language === 'es' || language === 'fr' ? language : 'en'
    return (
        <section
            aria-labelledby={`${state.formId}-settings`}
            className="grid gap-5 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
            <div>
                <h2
                    id={`${state.formId}-settings`}
                    className="text-lg font-extrabold text-ink-soft"
                >
                    {t('admin.ddns.form.title')}
                </h2>
                <p className="mt-1 text-sm text-muted">{t('admin.ddns.form.saveHint')}</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
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
                            maxValue={86_400}
                            disabled={state.locked}
                            locale={locale}
                            validationMode="external"
                        />
                    )}
                </form.Field>
                <fieldset disabled={state.locked} className="grid content-start gap-3">
                    <legend className="mb-3 text-sm font-bold text-ink-soft">
                        {t('admin.ddns.form.families')}
                    </legend>
                    <form.Field name="ipv4">
                        {(field) => (
                            <label className="flex min-h-8 items-center gap-3 text-sm text-ink-soft">
                                <CheckboxInput
                                    name="ipv4"
                                    checked={field.state.value}
                                    onChange={(event) => field.handleChange(event.target.checked)}
                                />
                                {t('admin.ddns.form.ipv4')}
                            </label>
                        )}
                    </form.Field>
                    <form.Field name="ipv6">
                        {(field) => (
                            <label className="flex min-h-8 items-center gap-3 text-sm text-ink-soft">
                                <CheckboxInput
                                    name="ipv6"
                                    checked={field.state.value}
                                    onChange={(event) => field.handleChange(event.target.checked)}
                                />
                                {t('admin.ddns.form.ipv6')}
                            </label>
                        )}
                    </form.Field>
                    <form.Field name="updateOnStart">
                        {(field) => (
                            <label className="flex min-h-8 items-center gap-3 text-sm text-ink-soft">
                                <CheckboxInput
                                    name="updateOnStart"
                                    checked={field.state.value}
                                    onChange={(event) => field.handleChange(event.target.checked)}
                                />
                                {t('admin.ddns.form.updateOnStart')}
                            </label>
                        )}
                    </form.Field>
                </fieldset>
            </div>
            <p className="text-sm leading-relaxed text-muted">{t('admin.ddns.form.familyHint')}</p>
            {state.canChooseConnection ? (
                <fieldset
                    disabled={state.locked}
                    className="grid min-w-0 gap-4 border-t border-border pt-5"
                >
                    <legend className="sr-only">{t('admin.ddns.form.addRecords')}</legend>
                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                        <CustomSelect
                            value={state.connectionId || null}
                            options={state.connectionOptions}
                            onValueChange={handler.changeConnection}
                            label={t('admin.ddns.form.connection')}
                            placeholder={t('admin.ddns.form.chooseConnection')}
                            disabled={state.locked || state.connectionsLoading}
                            locale={selectLocale}
                        />
                        <CustomSelect
                            value={state.zoneId}
                            options={state.zoneOptions}
                            onValueChange={handler.setZoneId}
                            label={t('admin.ddns.form.zone')}
                            disabled={state.locked || !state.connectionId}
                            locale={selectLocale}
                        />
                    </div>
                    {state.connectionsError ? (
                        <p role="alert" className="text-sm text-danger-text">
                            {t('admin.ddns.errors.connection_unavailable')}
                        </p>
                    ) : null}
                    {!state.connectionsLoading && !state.connectionOptions.length ? (
                        <p className="text-sm text-muted">
                            {t('admin.ddns.form.noConnections')}{' '}
                            <a
                                href="/dns-connections"
                                className="font-bold text-accent-ring underline"
                            >
                                {t('shell.dnsConnections')}
                            </a>
                        </p>
                    ) : null}
                    <Textarea
                        name="domains"
                        label={t('admin.ddns.form.domains')}
                        description={t('admin.ddns.form.domainsHint')}
                        value={state.domains}
                        onValueChange={handler.setDomains}
                        rows={3}
                        maxLength={32_000}
                        placeholder={t('admin.ddns.form.domainsPlaceholder')}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={state.locked || !state.connectionId}
                        locale={locale}
                    />
                    <button
                        type="button"
                        onClick={handler.addDomains}
                        disabled={state.locked || !state.connectionId || !state.domains.trim()}
                        className="min-h-11 justify-self-start rounded-xl border border-border-strong bg-surface-raised px-4 py-2 text-sm font-extrabold text-ink-soft disabled:opacity-50"
                    >
                        {t('admin.ddns.form.addRecords')}
                    </button>
                </fieldset>
            ) : (
                <p className="rounded-xl bg-surface-subtle p-3 text-sm text-muted">
                    {t('admin.ddns.form.connectionPermission')}
                </p>
            )}
        </section>
    )
}
