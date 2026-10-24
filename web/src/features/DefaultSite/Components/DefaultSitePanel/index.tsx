import { lazy, Suspense } from 'react'
import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'

import { MAX_DEFAULT_SITE_HTML_BYTES } from '@/config/default-site.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useDefaultSitePanelLogic } from './Hooks/useDefaultSitePanelLogic.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

const HtmlSourceEditor = lazy(() => import('./Components/HtmlSourceEditor/index.tsx'))

export default function DefaultSitePanel({ canUpdate }: { readonly canUpdate: boolean }) {
    const { t } = useTranslationStore()
    const { state, handler, form } = useDefaultSitePanelLogic(canUpdate)
    const retryButton = (
        <button
            type="button"
            className={buttonClassName('secondary')}
            onClick={handler.handleReload}
            disabled={state.isReloading}
            aria-busy={state.isReloading}
        >
            {t('common.retry')}
        </button>
    )

    return (
        <section
            aria-labelledby="default-site-heading"
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
        >
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 grow basis-64">
                    <h2
                        id="default-site-heading"
                        className="m-0 text-xl font-extrabold text-ink-soft"
                    >
                        {t('defaultSite.title')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                        {t('defaultSite.description')}
                    </p>
                </div>
                {state.savedMode ? (
                    <span className="inline-flex max-w-full shrink-0 items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted">
                        <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-brand-text"
                        />
                        <span className="min-w-0 break-words">
                            {t('defaultSite.current')}: {t(`defaultSite.modes.${state.savedMode}`)}
                        </span>
                    </span>
                ) : null}
            </div>
            {state.isLoading ? (
                <output className="mt-5 block text-sm text-muted">
                    {t('defaultSite.loading')}
                </output>
            ) : null}
            {state.loadFailed ? (
                <>
                    <PageAlert
                        severity="error"
                        title={t('defaultSite.title')}
                        description={t('defaultSite.errors.loadFailed')}
                        action={retryButton}
                    />
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                        <p className="text-sm text-danger-text">
                            {t('defaultSite.errors.loadFailed')}
                        </p>
                        {retryButton}
                    </div>
                </>
            ) : null}
            {state.error ? (
                <p role="alert" className="mt-4 text-sm text-danger-text">
                    {state.error}
                </p>
            ) : null}
            {state.runtimeStatus === 'pending' ? (
                <PageAlert
                    severity="warning"
                    title={t('defaultSite.title')}
                    description={t('defaultSite.pending')}
                />
            ) : state.runtimeStatus ? (
                <output className="mt-4 block text-sm text-muted">{t('defaultSite.saved')}</output>
            ) : null}
            {!state.isLoading && !state.loadFailed ? (
                <form className="mt-6 grid gap-4" onSubmit={handler.handleSubmit}>
                    <div className="grid gap-2">
                        <label
                            htmlFor="default-site-mode"
                            className="text-sm font-bold text-ink-soft"
                        >
                            {t('defaultSite.mode')}
                        </label>
                        <CustomSelect
                            id="default-site-mode"
                            name="mode"
                            aria-label={t('defaultSite.mode')}
                            value={state.mode}
                            options={state.modeOptions}
                            onValueChange={handler.handleModeChange}
                            disabled={!canUpdate || state.isSaving || state.isReloading}
                        />
                    </div>
                    {state.mode === 'redirect' ? (
                        <form.Field name="url">
                            {(field) => (
                                <div className="grid min-w-0 gap-2">
                                    <label
                                        htmlFor="default-site-url"
                                        className="text-sm font-bold text-ink-soft"
                                    >
                                        {t('defaultSite.url')}
                                    </label>
                                    <TextInput
                                        id="default-site-url"
                                        placeholder={t('placeholders.defaultRedirectUrl')}
                                        name={field.name}
                                        value={field.state.value}
                                        onValueChange={field.handleChange}
                                        onBlur={field.handleBlur}
                                        disabled={!canUpdate || state.isSaving || state.isReloading}
                                        maxLength={2048}
                                        autoCapitalize="none"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        aria-invalid={!state.isValid}
                                        aria-describedby="default-site-url-hint default-site-validation"
                                    />
                                    <p id="default-site-url-hint" className="text-sm text-muted">
                                        {t('defaultSite.redirectHint')}
                                    </p>
                                </div>
                            )}
                        </form.Field>
                    ) : null}
                    {state.mode === 'custom-html' ? (
                        <form.Field name="html">
                            {(field) => (
                                <div className="grid min-w-0 gap-2">
                                    <label
                                        htmlFor="default-site-html"
                                        className="text-sm font-bold text-ink-soft"
                                    >
                                        {t('defaultSite.html')}
                                    </label>
                                    <Suspense
                                        fallback={
                                            <output className="block min-h-90 w-full rounded-xl border border-border-strong bg-surface-raised p-4 text-sm text-muted">
                                                {t('defaultSite.editor.loading')}
                                            </output>
                                        }
                                    >
                                        <HtmlSourceEditor
                                            id="default-site-html"
                                            value={field.state.value}
                                            onChange={field.handleChange}
                                            onBlur={field.handleBlur}
                                            disabled={
                                                !canUpdate || state.isSaving || state.isReloading
                                            }
                                            invalid={!state.isValid}
                                            describedBy="default-site-html-hint"
                                        />
                                    </Suspense>
                                    <p id="default-site-html-hint" className="text-sm text-muted">
                                        {t('defaultSite.htmlHint')}
                                    </p>
                                    <output className="text-xs text-muted">
                                        {t('defaultSite.htmlBytes', {
                                            bytes: state.htmlBytes,
                                            max: MAX_DEFAULT_SITE_HTML_BYTES,
                                        })}
                                    </output>
                                </div>
                            )}
                        </form.Field>
                    ) : null}
                    {state.mode === 'redirect' && !state.isValid ? (
                        <p
                            id="default-site-validation"
                            role="alert"
                            className="text-sm text-danger-text"
                        >
                            {t('defaultSite.errors.invalidUrl')}
                        </p>
                    ) : null}
                    <p className="text-xs leading-relaxed text-muted">{t('defaultSite.tlsHint')}</p>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                        {canUpdate ? (
                            <output
                                aria-live="polite"
                                className={
                                    state.isDirty ? 'text-xs text-brand-text' : 'text-xs text-muted'
                                }
                            >
                                {t(state.isDirty ? 'defaultSite.dirty' : 'defaultSite.clean')}
                            </output>
                        ) : (
                            <p className="text-xs text-muted">{t('defaultSite.readOnly')}</p>
                        )}
                        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                            <button
                                type="button"
                                onClick={handler.handleReload}
                                disabled={
                                    state.isSaving ||
                                    state.isReloading ||
                                    (canUpdate && !state.isDirty && !state.error)
                                }
                                className={buttonClassName(canUpdate ? 'ghost' : 'secondary')}
                            >
                                {t(canUpdate ? 'defaultSite.discard' : 'defaultSite.reload')}
                            </button>
                            {canUpdate ? (
                                <button
                                    type="submit"
                                    disabled={!state.canSave}
                                    aria-busy={state.isSaving}
                                    className={buttonClassName('primary')}
                                >
                                    {t(state.isSaving ? 'common.saving' : 'common.save')}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </form>
            ) : null}
        </section>
    )
}
