import { lazy, Suspense } from 'react'
import { TextInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { Globe } from 'lucide-react'

import { MAX_DEFAULT_SITE_HTML_BYTES } from '@/config/default-site.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useDefaultSitePanelLogic } from './Hooks/useDefaultSitePanelLogic.ts'

const HtmlSourceEditor = lazy(() => import('./Components/HtmlSourceEditor/index.tsx'))

export default function DefaultSitePanel({ canUpdate }: { readonly canUpdate: boolean }) {
    const { t } = useTranslationStore()
    const { state, handler, form } = useDefaultSitePanelLogic(canUpdate)

    return (
        <section
            aria-labelledby="default-site-heading"
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
        >
            <div className="flex items-start gap-3">
                <Globe aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-text" />
                <div>
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
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">{t('defaultSite.tlsHint')}</p>
            {state.isLoading ? <output>{t('defaultSite.loading')}</output> : null}
            {state.loadFailed ? (
                <p role="alert" className="text-danger-text">
                    {t('defaultSite.errors.loadFailed')}
                </p>
            ) : null}
            {state.savedMode ? (
                <p className="mt-4 text-sm font-bold text-ink-soft">
                    {t('defaultSite.current')}: {t(`defaultSite.modes.${state.savedMode}`)}
                </p>
            ) : null}
            {state.error ? (
                <p role="alert" className="text-danger-text">
                    {state.error}
                </p>
            ) : null}
            {state.runtimeStatus ? (
                <output className="block text-sm text-muted">
                    {t(
                        state.runtimeStatus === 'pending'
                            ? 'defaultSite.pending'
                            : 'defaultSite.saved',
                    )}
                </output>
            ) : null}
            {!state.isLoading && !state.loadFailed ? (
                <form className="mt-5 grid gap-4" onSubmit={handler.handleSubmit}>
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
                                            describedBy="default-site-html-hint default-site-validation"
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
                    {!state.isValid ? (
                        <p
                            id="default-site-validation"
                            role="alert"
                            className="text-sm text-danger-text"
                        >
                            {t(
                                state.mode === 'redirect'
                                    ? 'defaultSite.errors.invalidUrl'
                                    : 'defaultSite.errors.invalidHtml',
                            )}
                        </p>
                    ) : null}
                    {canUpdate ? (
                        <>
                            <output className="block text-sm text-muted">
                                {t(state.isDirty ? 'defaultSite.dirty' : 'defaultSite.clean')}
                            </output>
                            <button
                                type="submit"
                                disabled={!state.canSave}
                                aria-busy={state.isSaving}
                                className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground transition-colors enabled:hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-55"
                            >
                                {t(state.isSaving ? 'common.saving' : 'common.save')}
                            </button>
                        </>
                    ) : (
                        <p className="text-sm text-muted">{t('defaultSite.readOnly')}</p>
                    )}
                </form>
            ) : null}
            <button
                type="button"
                onClick={handler.handleReload}
                disabled={state.isSaving || state.isReloading}
                className="mt-4 inline-flex h-12 items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-bold text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-55"
            >
                {t('defaultSite.reload')}
            </button>
        </section>
    )
}
