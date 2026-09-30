import { Languages } from 'lucide-react'
import { CustomSelect } from '@rentnerkev/select/select'

import useTranslationStore from '../../../language/useTranslationStore'
import { LANGUAGE_COUNTRY_CODES } from '../../../config/language.config'
import useLanguageSettingsLogic from '../Hooks/useLanguageSettingsLogic'

function LanguageOptionLabel({
    countryCode,
    label,
}: {
    readonly countryCode: string
    readonly label: string
}) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span
                aria-hidden="true"
                className={`flag:${countryCode} h-4 w-6 shrink-0 rounded-sm ring-1 ring-black/10 [--CountryFlagIcon-height:1rem]`}
            />
            <span className="truncate">{label}</span>
        </span>
    )
}

export default function LanguageSettingsPanel() {
    const { t } = useTranslationStore()
    const { handler, state } = useLanguageSettingsLogic()

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="account-language-heading"
        >
            <div className="flex items-start gap-3">
                <Languages aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-text" />
                <div>
                    <h2
                        id="account-language-heading"
                        className="m-0 text-xl font-extrabold text-ink-soft"
                    >
                        {t('language.title')}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                        {t('language.description')}
                    </p>
                </div>
            </div>
            <form
                className="mt-5 grid gap-4"
                onSubmit={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    handler.handleSave()
                }}
            >
                <div className="grid gap-[0.45rem]">
                    <span className="text-[0.82rem] font-[750] text-ink-soft">
                        {t('language.label')}
                    </span>
                    <CustomSelect
                        aria-label={t('language.label')}
                        className="sm:max-w-xs"
                        disabled={state.isSaving}
                        onValueChange={handler.handleLanguageChange}
                        options={state.options}
                        renderOption={(option) => (
                            <LanguageOptionLabel
                                countryCode={LANGUAGE_COUNTRY_CODES[option.value]}
                                label={option.label}
                            />
                        )}
                        renderValue={(selected) => {
                            const option = selected[0]
                            return option ? (
                                <LanguageOptionLabel
                                    countryCode={LANGUAGE_COUNTRY_CODES[option.value]}
                                    label={option.label}
                                />
                            ) : null
                        }}
                        value={state.selectedLanguage}
                    />
                    <output
                        className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                        aria-live="polite"
                    >
                        {t(state.isSaving ? 'language.saving' : 'language.hint')}
                    </output>
                </div>
                <button
                    type="submit"
                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover justify-self-start"
                    disabled={!state.isDirty || state.isSaving}
                    aria-busy={state.isSaving}
                >
                    {t(state.isSaving ? 'language.saving' : 'common.save')}
                </button>
            </form>
        </section>
    )
}
