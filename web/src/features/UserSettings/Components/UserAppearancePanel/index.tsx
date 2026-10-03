import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { CustomColorPicker, type CustomColorPickerDesign } from '@rentnerkev/picker'
import { Palette } from 'lucide-react'
import { type CSSProperties } from 'react'

import { DEFAULT_ACCENT_COLOR } from '@/config/appearance.config.ts'
import { accentCssVariables } from '@/lib/Theme/accentPalette.ts'
import type { UserAppearancePanelProps } from './Types/user-appearance-panel.types.ts'
import { useUserAppearancePanelLogic } from './Hooks/useUserAppearancePanelLogic.ts'

const pickerDesign: CustomColorPickerDesign = {
    bg: 'bg-surface-raised',
    border: 'border-input-border',
    text: 'text-ink',
    placeholder: 'placeholder:text-muted-soft',
    focusRing: 'focus-within:ring-accent-ring/30',
    focusBorder: 'focus-within:border-accent-ring',
    errorBorder: 'border-danger-text',
    errorRing: 'focus-within:ring-danger-text/40',
    errorText: 'text-danger-text',
    labelText: 'text-ink-soft',
    descriptionText: 'text-muted',
    iconColor: 'text-muted',
    iconFocus: 'group-focus-within:text-brand-text',
    hoverText: 'hover:text-brand-text',
    previewBorder: 'border-border-strong',
    presetBorder: 'border-border-strong',
    presetActiveBorder: 'ring-accent-ring border-accent-ring',
}

export default function UserAppearancePanel({ userId }: UserAppearancePanelProps) {
    const { t } = useTranslationStore()
    const { state, handler, setter } = useUserAppearancePanelLogic(userId)

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="user-appearance-heading"
            style={accentCssVariables(state.previewColor) as CSSProperties}
        >
            <div className="flex items-start gap-3">
                <Palette aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-text" />
                <div>
                    <h2
                        id="user-appearance-heading"
                        className="m-0 text-xl font-extrabold text-ink-soft"
                    >
                        {t('userAppearance.title')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                        {t('userAppearance.description')}
                    </p>
                </div>
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface-subtle px-4 py-3">
                <span
                    aria-hidden="true"
                    className="size-8 shrink-0 rounded-full border border-border-strong shadow-sm"
                    style={{ backgroundColor: state.accentColor }}
                />
                <div className="min-w-0">
                    <p className="m-0 text-xs font-bold text-muted">
                        {t('userAppearance.current')}
                    </p>
                    <output className="font-mono text-sm font-bold text-ink-soft">
                        {state.accentColor}
                    </output>
                </div>
                {state.accentColor === DEFAULT_ACCENT_COLOR ? (
                    <span className="ml-auto rounded-full border border-accent-border bg-accent-muted px-2 py-1 text-xs font-bold text-brand-text">
                        {t('userAppearance.default')}
                    </span>
                ) : null}
            </div>
            <form className="mt-5 grid gap-4" onSubmit={handler.handleSubmit}>
                <CustomColorPicker
                    id="user-accent-color"
                    name="userAccentColor"
                    label={t('userAppearance.label')}
                    description={t('userAppearance.hint')}
                    value={state.draftColor}
                    onValueChange={setter.setDraftColor}
                    onValidityChange={setter.setIsValid}
                    locale={state.pickerLocale}
                    messages={state.pickerMessages}
                    customDesign={pickerDesign}
                    disabled={state.isSaving}
                    required
                />
                <div className="grid gap-3 rounded-xl border border-accent-border bg-accent-muted p-3 sm:grid-cols-2">
                    <div
                        data-theme="light"
                        className="rounded-lg border border-border bg-surface p-3"
                    >
                        <p className="m-0 text-xs font-bold text-brand-text">
                            {t('theme.light')} · {t('userAppearance.preview')}
                        </p>
                        <span className="mt-2 inline-flex min-h-9 items-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground">
                            {t('userAppearance.previewButton')}
                        </span>
                    </div>
                    <div
                        data-theme="dark"
                        className="rounded-lg border border-border bg-surface p-3"
                    >
                        <p className="m-0 text-xs font-bold text-brand-text">
                            {t('theme.dark')} · {t('userAppearance.preview')}
                        </p>
                        <span className="mt-2 inline-flex min-h-9 items-center rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground">
                            {t('userAppearance.previewButton')}
                        </span>
                    </div>
                </div>
                <div className="flex flex-wrap gap-3">
                    <button
                        type="submit"
                        className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground transition-colors enabled:hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-55"
                        disabled={!state.canSave}
                        aria-busy={state.isSaving}
                    >
                        {t(state.isSaving ? 'common.saving' : 'common.save')}
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-12 items-center justify-center rounded-xl border border-border-strong bg-surface-raised px-4 text-sm font-bold text-ink-soft transition-colors enabled:hover:border-accent-border enabled:hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:opacity-55"
                        disabled={state.resetDisabled}
                        onClick={handler.handleReset}
                    >
                        {t('userAppearance.reset')}
                    </button>
                </div>
            </form>
        </section>
    )
}
