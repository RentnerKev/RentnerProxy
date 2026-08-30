import { Languages } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'
import FormMessage from '../../../shared/Forms/FormMessage'
import SelectControl from '../../../shared/Select'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useLanguageSettingsLogic from '../Hooks/useLanguageSettingsLogic'

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
                    <SelectControl
                        ariaLabel={t('language.label')}
                        className="w-full sm:max-w-xs"
                        disabled={state.isSaving}
                        onValueChange={handler.handleLanguageChange}
                        options={state.options}
                        value={state.selectedLanguage}
                    />
                    <output className={uiClassNames.form.hint} aria-live="polite">
                        {t(state.isSaving ? 'language.saving' : 'language.hint')}
                    </output>
                </div>
                {state.errorMessage ? (
                    <FormMessage tone="error">{state.errorMessage}</FormMessage>
                ) : null}
                {state.saved && !state.errorMessage ? (
                    <FormMessage tone="success">{t('language.saved')}</FormMessage>
                ) : null}
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
