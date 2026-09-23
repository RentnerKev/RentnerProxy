import { LockKeyhole, Network, RefreshCw } from 'lucide-react'
import { PasswordInput, TextInput } from '@rentnerkev/inputs'

import {
    CROWDSEC_API_KEY_MAX_LENGTH,
    CROWDSEC_API_URL_MAX_LENGTH,
    type CrowdSecMode,
} from '../../../../config/crowdsec.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { CrowdSecPageViewProps } from '../Types/crowdsec.types'
import CrowdSecStatusPanel from './CrowdSecStatusPanel'
import CrowdSecTransitionModal from './CrowdSecTransitionModal'

function ModeOption({
    mode,
    selected,
    disabled,
    onSelect,
}: {
    readonly mode: CrowdSecMode
    readonly selected: boolean
    readonly disabled: boolean
    readonly onSelect: (mode: CrowdSecMode) => void
}) {
    const { t } = useTranslationStore()
    return (
        <div className="min-w-0">
            <input
                id={`crowdsec-mode-${mode}`}
                className="peer sr-only"
                type="radio"
                name="crowdsec-mode"
                value={mode}
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(mode)}
            />
            <label
                htmlFor={`crowdsec-mode-${mode}`}
                className={`flex min-w-0 items-start gap-3 rounded-xl border p-4 text-left transition-[border-color,background-color] duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 motion-reduce:transition-none ${
                    disabled
                        ? 'cursor-not-allowed opacity-65'
                        : 'cursor-pointer hover:border-brand-500/35'
                } ${
                    selected
                        ? 'border-brand-500/45 bg-brand-500/[0.06]'
                        : 'border-border bg-surface-raised'
                }`}
            >
                <span
                    className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-brand-500' : 'border-border-strong'}`}
                    aria-hidden="true"
                >
                    {selected ? <span className="size-2 rounded-full bg-brand-500" /> : null}
                </span>
                <span className="grid gap-1">
                    <span className="text-sm font-bold text-ink-soft">
                        {t(`admin.crowdSec.modes.${mode}.title`)}
                    </span>
                    <span className="text-xs leading-relaxed text-muted">
                        {t(`admin.crowdSec.modes.${mode}.description`)}
                    </span>
                </span>
            </label>
        </div>
    )
}

export default function CrowdSecPageView({ logic: { state, handler } }: CrowdSecPageViewProps) {
    const { t } = useTranslationStore()
    const busy = state.isSaving || state.isTesting
    return (
        <>
            <PageHeader
                eyebrow={t('admin.crowdSec.page.eyebrow')}
                title={t('admin.crowdSec.page.title')}
                description={t('admin.crowdSec.page.description')}
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.crowdSec.statesPage.unavailableTitle')}
                    description={t('admin.crowdSec.statesPage.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : state.isLoading || !state.configuration ? (
                <ContentState
                    title={t('admin.crowdSec.statesPage.loadingTitle')}
                    description={t('admin.crowdSec.statesPage.loadingDescription')}
                />
            ) : (
                <>
                    <CrowdSecStatusPanel configuration={state.configuration} />
                    <section className={uiClassNames.management.card}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className={uiClassNames.themedTechnicalLabel}>
                                    {t('admin.crowdSec.configuration.eyebrow')}
                                </p>
                                <h2 className="mt-2 text-xl font-extrabold text-ink">
                                    {t('admin.crowdSec.configuration.title')}
                                </h2>
                                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                                    {t('admin.crowdSec.configuration.description')}
                                </p>
                            </div>
                            {state.isRefreshing ? (
                                <span className="inline-flex items-center gap-2 text-xs text-muted">
                                    <RefreshCw
                                        aria-hidden="true"
                                        className="size-3.5 animate-spin motion-reduce:animate-none"
                                    />
                                    {t('admin.crowdSec.configuration.refreshing')}
                                </span>
                            ) : null}
                        </div>

                        <fieldset className="mt-6 grid min-w-0 gap-2 border-0 p-0">
                            <legend className="sr-only">
                                {t('admin.crowdSec.configuration.modeLabel')}
                            </legend>
                            {(['disabled', 'managed', 'external'] as const).map((mode) => (
                                <ModeOption
                                    key={mode}
                                    mode={mode}
                                    selected={state.mode === mode}
                                    disabled={!state.canUpdate || busy}
                                    onSelect={handler.setMode}
                                />
                            ))}
                        </fieldset>

                        {state.mode === 'external' ? (
                            <div className="mt-6 border-t border-border pt-5">
                                <div className="mb-5">
                                    <h3 className="text-sm font-bold text-ink-soft">
                                        {t('admin.crowdSec.external.title')}
                                    </h3>
                                    <p className="mt-1 text-xs leading-relaxed text-muted">
                                        {t('admin.crowdSec.external.description')}
                                    </p>
                                </div>
                                <div className="grid items-start gap-4 md:grid-cols-2">
                                    <div className={uiClassNames.form.field}>
                                        <label
                                            className={uiClassNames.form.label}
                                            htmlFor="crowdsec-api-url"
                                        >
                                            {t('admin.crowdSec.external.apiUrl')}
                                        </label>
                                        <TextInput
                                            id="crowdsec-api-url"
                                            name="crowdsec-api-url"
                                            value={state.apiUrl}
                                            disabled={!state.canUpdate || busy}
                                            inputMode="url"
                                            autoComplete="url"
                                            maxLength={CROWDSEC_API_URL_MAX_LENGTH}
                                            placeholder={t(
                                                'admin.crowdSec.external.apiUrlPlaceholder',
                                            )}
                                            aria-invalid={
                                                state.fieldErrors.apiUrl ? true : undefined
                                            }
                                            aria-describedby="crowdsec-api-url-error"
                                            onChange={(event) =>
                                                handler.setApiUrl(event.target.value)
                                            }
                                        />
                                        <FieldError
                                            id="crowdsec-api-url-error"
                                            errors={
                                                state.fieldErrors.apiUrl
                                                    ? [state.fieldErrors.apiUrl]
                                                    : []
                                            }
                                        />
                                    </div>
                                    <div className={uiClassNames.form.field}>
                                        <label
                                            className={uiClassNames.form.label}
                                            htmlFor="crowdsec-api-key"
                                        >
                                            {t('admin.crowdSec.external.apiKey')}
                                        </label>
                                        <PasswordInput
                                            id="crowdsec-api-key"
                                            name="crowdsec-api-key"
                                            type="password"
                                            value={state.apiKey}
                                            disabled={!state.canUpdate || busy}
                                            autoComplete="new-password"
                                            maxLength={CROWDSEC_API_KEY_MAX_LENGTH}
                                            placeholder={t(
                                                state.configuration.hasApiKey
                                                    ? 'admin.crowdSec.external.apiKeyReplacePlaceholder'
                                                    : 'admin.crowdSec.external.apiKeyPlaceholder',
                                            )}
                                            aria-invalid={
                                                state.fieldErrors.apiKey ? true : undefined
                                            }
                                            aria-describedby="crowdsec-api-key-hint crowdsec-api-key-error"
                                            onChange={(event) =>
                                                handler.setApiKey(event.target.value)
                                            }
                                        />
                                        <FieldError
                                            id="crowdsec-api-key-error"
                                            errors={
                                                state.fieldErrors.apiKey
                                                    ? [state.fieldErrors.apiKey]
                                                    : []
                                            }
                                        />
                                        <p
                                            id="crowdsec-api-key-hint"
                                            className={uiClassNames.form.hint}
                                        >
                                            {t('admin.crowdSec.external.apiKeyHint')}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                            <p className="m-0 max-w-xl text-xs leading-relaxed text-muted">
                                {t('admin.crowdSec.configuration.retention')}
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                                {state.mode === 'external' ? (
                                    <button
                                        type="button"
                                        className={uiClassNames.button.secondary}
                                        disabled={
                                            !state.canUpdate || busy || state.apiUrl.length === 0
                                        }
                                        onClick={handler.testConnection}
                                    >
                                        <Network aria-hidden="true" className="size-4" />
                                        {t(
                                            state.isTesting
                                                ? 'admin.crowdSec.actions.testing'
                                                : 'admin.crowdSec.actions.test',
                                        )}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className={uiClassNames.button.primary}
                                    disabled={!state.canUpdate || !state.isDirty || busy}
                                    onClick={handler.save}
                                >
                                    <LockKeyhole aria-hidden="true" className="size-4" />
                                    {t(
                                        state.isSaving
                                            ? 'admin.crowdSec.actions.saving'
                                            : 'admin.crowdSec.actions.save',
                                    )}
                                </button>
                            </div>
                        </div>
                    </section>

                    <section
                        className={`${uiClassNames.management.card} mt-4`}
                        aria-label={t('admin.crowdSec.facts.title')}
                    >
                        <p className={uiClassNames.themedTechnicalLabel}>
                            {t('admin.crowdSec.facts.title')}
                        </p>
                        <div className="mt-4 grid gap-5 md:grid-cols-3">
                            {(['clientIp', 'failure', 'deployment'] as const).map((item) => (
                                <div key={item}>
                                    <p className="text-[0.68rem] font-bold tracking-[0.12em] text-muted uppercase">
                                        {t(`admin.crowdSec.facts.${item}.label`)}
                                    </p>
                                    <p className="mt-1.5 text-sm font-bold text-ink-soft">
                                        {t(`admin.crowdSec.facts.${item}.value`)}
                                    </p>
                                    <p className="mt-1.5 text-xs leading-relaxed text-muted">
                                        {t(`admin.crowdSec.facts.${item}.description`)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </section>
                </>
            )}
            {state.transition && state.transitionProgress ? (
                <CrowdSecTransitionModal
                    transition={state.transition}
                    progress={state.transitionProgress}
                    onClose={handler.closeTransition}
                />
            ) : null}
        </>
    )
}
