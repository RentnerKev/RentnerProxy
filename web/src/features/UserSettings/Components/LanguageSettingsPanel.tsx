import { Languages } from 'lucide-react'
import { CustomSelect } from '@rentnerkev/select/select'

import useTranslationStore from '../../../language/useTranslationStore'
import { LANGUAGE_COUNTRY_CODES } from '../../../config/language.config'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
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
            className={uiClassNames.management.card}
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
                <div className={uiClassNames.form.field}>
                    <span className={uiClassNames.form.label}>{t('language.label')}</span>
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
                    <output className={uiClassNames.form.hint} aria-live="polite">
                        {t(state.isSaving ? 'language.saving' : 'language.hint')}
                    </output>
                </div>
                <button
                    type="submit"
                    className={`${uiClassNames.button.primary} justify-self-start`}
                    disabled={!state.isDirty || state.isSaving}
                    aria-busy={state.isSaving}
                >
                    {t(state.isSaving ? 'language.saving' : 'common.save')}
                </button>
            </form>
        </section>
    )
}
