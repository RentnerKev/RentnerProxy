import { CustomColorPicker } from '@rentnerkev/picker'
import { Palette } from 'lucide-react'
import { type CSSProperties } from 'react'

import { DEFAULT_ACCENT_COLOR } from '../../../config/appearance.config'
import { accentCssVariables } from '../../../theme/accentPalette'
import { useSystemAppearancePanel } from '../Hooks/useSystemAppearancePanel'

export default function SystemAppearancePanel({ canUpdate }: { readonly canUpdate: boolean }) {
    const {
        accentColor,
        canSave,
        draftColor,
        isSaving,
        language,
        pickerMessages,
        previewColor,
        resetDisabled,
        reset,
        saveDraft,
        setDraftColor,
        setIsValid,
        t,
    } = useSystemAppearancePanel(canUpdate)

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="system-appearance-heading"
            style={accentCssVariables(previewColor) as CSSProperties}
        >
            <div className="flex items-start gap-3">
                <Palette aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-text" />
                <div>
                    <h2
                        id="system-appearance-heading"
                        className="m-0 text-xl font-extrabold text-ink-soft"
                    >
                        {t('systemAppearance.title')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                        {t('systemAppearance.description')}
                    </p>
                </div>
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface-subtle px-4 py-3">
                <span
                    aria-hidden="true"
                    className="size-8 shrink-0 rounded-full border border-border-strong shadow-sm"
                    style={{ backgroundColor: accentColor }}
                />
                <div className="min-w-0">
                    <p className="m-0 text-xs font-bold text-muted">
                        {t('systemAppearance.current')}
                    </p>
                    <output className="font-mono text-sm font-bold text-ink-soft">
                        {accentColor}
                    </output>
                </div>
                {accentColor === DEFAULT_ACCENT_COLOR ? (
                    <span className="ml-auto rounded-full border border-accent-border bg-accent-muted px-2 py-1 text-xs font-bold text-brand-text">
                        {t('systemAppearance.default')}
                    </span>
                ) : null}
            </div>
            {canUpdate ? (
                <form
                    className="mt-5 grid gap-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        saveDraft()
                    }}
                >
                    <CustomColorPicker
                        id="system-accent-color"
                        name="systemAccentColor"
                        label={t('systemAppearance.label')}
                        description={t('systemAppearance.hint')}
                        value={draftColor}
                        onValueChange={setDraftColor}
                        onValidityChange={setIsValid}
                        locale={language === 'de' ? 'de' : 'en'}
                        messages={pickerMessages}
                        disabled={isSaving}
                        required
                    />
                    <div className="grid gap-3 rounded-xl border border-accent-border bg-accent-muted p-3 sm:grid-cols-2">
                        <div
                            data-theme="light"
                            className="rounded-lg border border-border bg-surface p-3"
                        >
                            <p className="m-0 text-xs font-bold text-brand-text">
                                {t('theme.light')} · {t('systemAppearance.preview')}
                            </p>
                            <span className="mt-2 inline-flex min-h-9 items-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground">
                                {t('systemAppearance.previewButton')}
                            </span>
                        </div>
                        <div
                            data-theme="dark"
                            className="rounded-lg border border-border bg-surface p-3"
                        >
                            <p className="m-0 text-xs font-bold text-brand-text">
                                {t('theme.dark')} · {t('systemAppearance.preview')}
                            </p>
                            <span className="mt-2 inline-flex min-h-9 items-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground">
                                {t('systemAppearance.previewButton')}
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <button
                            type="submit"
                            className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground transition-colors enabled:hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-55"
                            disabled={!canSave}
                            aria-busy={isSaving}
                        >
                            {t(isSaving ? 'common.saving' : 'common.save')}
                        </button>
                        <button
                            type="button"
                            className="inline-flex h-12 items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-bold text-ink-soft transition-colors enabled:hover:border-accent-border enabled:hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-55"
                            disabled={resetDisabled}
                            onClick={reset}
                        >
                            {t('systemAppearance.reset')}
                        </button>
                    </div>
                </form>
            ) : (
                <p className="mt-4 text-sm text-muted">{t('systemAppearance.adminOnly')}</p>
            )}
        </section>
    )
}
