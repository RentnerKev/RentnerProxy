import { Check, Languages } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'
import { LANGUAGE_COUNTRY_CODES, LANGUAGE_NATIVE_NAMES } from '../../../config/language.config'
import useLanguageSettingsLogic from '../Hooks/useLanguageSettingsLogic'

export default function LanguageSettingsPanel() {
    const { t } = useTranslationStore()
    const { handler, state } = useLanguageSettingsLogic()

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="account-language-heading"
        >
            <div className="flex items-start gap-3">
                <Languages aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-ring" />
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
                <fieldset className="min-w-0" aria-describedby="account-language-hint">
                    <legend className="mb-3 text-[0.82rem] font-[750] text-ink-soft">
                        {t('language.label')}
                    </legend>
                    <div className="grid grid-cols-2 gap-3 2xl:grid-cols-4">
                        {state.options.map((option) => {
                            const selected = state.selectedLanguage === option.value
                            const nativeName = LANGUAGE_NATIVE_NAMES[option.value]

                            return (
                                <label key={option.value} className="relative min-w-0">
                                    <input
                                        type="radio"
                                        name="account-language"
                                        value={option.value}
                                        checked={selected}
                                        disabled={state.isSaving}
                                        aria-label={option.label}
                                        className="peer sr-only"
                                        onChange={() => handler.handleLanguageChange(option.value)}
                                    />
                                    <span className="flex h-full min-h-32 cursor-pointer flex-col rounded-xl border border-border-strong bg-surface-raised p-4 transition-colors hover:border-accent-border peer-checked:border-accent-ring peer-checked:bg-accent-muted peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-55 motion-reduce:transition-none">
                                        <span className="mb-4 flex items-center justify-between gap-2">
                                            <span
                                                aria-hidden="true"
                                                className={`flag:${LANGUAGE_COUNTRY_CODES[option.value]} h-6 w-9 shrink-0 rounded-sm ring-1 ring-black/10 [--CountryFlagIcon-height:1.5rem]`}
                                            />
                                            <span
                                                aria-hidden="true"
                                                className={`grid size-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border-strong'}`}
                                            >
                                                {selected ? (
                                                    <Check className="size-3.5" strokeWidth={3} />
                                                ) : null}
                                            </span>
                                        </span>
                                        <span className="font-extrabold wrap-anywhere text-ink-soft">
                                            {nativeName}
                                        </span>
                                        {nativeName !== option.label ? (
                                            <span className="mt-1 text-xs wrap-anywhere text-muted">
                                                {option.label}
                                            </span>
                                        ) : null}
                                    </span>
                                </label>
                            )
                        })}
                    </div>
                </fieldset>
                <output
                    id="account-language-hint"
                    className="m-0 text-[0.76rem] leading-[1.45] text-muted"
                    aria-live="polite"
                >
                    {t(state.isSaving ? 'language.saving' : 'language.hint')}
                </output>
                <button
                    type="submit"
                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover justify-self-start"
                    disabled={!state.isDirty || state.isSaving}
                    aria-busy={state.isSaving}
                >
                    {t(state.isSaving ? 'language.saving' : 'common.save')}
                </button>
            </form>
        </section>
    )
}
