import {
    CloudCog,
    KeyRound,
    LockKeyhole,
    Network,
    RefreshCw,
    ServerCog,
    ShieldOff,
} from 'lucide-react'
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

const MODE_ICONS = {
    disabled: ShieldOff,
    managed: ServerCog,
    external: CloudCog,
} as const

function ModeCard({
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
    const Icon = MODE_ICONS[mode]
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
                className={`group block min-w-0 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 motion-reduce:transition-none ${
                    disabled
                        ? 'cursor-not-allowed opacity-65'
                        : 'cursor-pointer hover:-translate-y-0.5 hover:border-brand-500/30'
                } ${
                    selected
                        ? 'border-brand-500/55 bg-brand-500/10 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-brand-500)_18%,transparent)]'
                        : 'border-border bg-surface-raised'
                }`}
            >
                <span
                    className={`mb-4 grid size-10 place-items-center rounded-xl ${selected ? 'bg-brand-500 text-navy-950' : 'bg-code text-muted'}`}
                >
                    <Icon aria-hidden="true" className="size-5" strokeWidth={1.8} />
                </span>
                <span className="block text-sm font-extrabold text-ink">
                    {t(`admin.crowdSec.modes.${mode}.title`)}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-muted">
                    {t(`admin.crowdSec.modes.${mode}.description`)}
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

                        <div
                            className="mt-6 grid gap-3 md:grid-cols-3"
                            role="radiogroup"
                            aria-label={t('admin.crowdSec.configuration.modeLabel')}
                        >
                            {(['disabled', 'managed', 'external'] as const).map((mode) => (
                                <ModeCard
                                    key={mode}
                                    mode={mode}
                                    selected={state.mode === mode}
                                    disabled={!state.canUpdate || busy}
                                    onSelect={handler.setMode}
                                />
                            ))}
                        </div>

                        {state.mode === 'external' ? (
                            <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-5">
                                <div className="mb-5 flex items-start gap-3">
                                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-code text-brand-text">
                                        <KeyRound aria-hidden="true" className="size-4.5" />
                                    </span>
                                    <div>
                                        <h3 className="text-sm font-extrabold text-ink">
                                            {t('admin.crowdSec.external.title')}
                                        </h3>
                                        <p className="mt-1 text-xs leading-relaxed text-muted">
                                            {t('admin.crowdSec.external.description')}
                                        </p>
                                    </div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
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
                                <button
                                    type="button"
                                    className={`${uiClassNames.button.secondary} mt-5`}
                                    disabled={!state.canUpdate || busy || state.apiUrl.length === 0}
                                    onClick={handler.testConnection}
                                >
                                    <Network aria-hidden="true" className="size-4" />
                                    {t(
                                        state.isTesting
                                            ? 'admin.crowdSec.actions.testing'
                                            : 'admin.crowdSec.actions.test',
                                    )}
                                </button>
                            </div>
                        ) : null}

                        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                            <p className="m-0 max-w-xl text-xs leading-relaxed text-muted">
                                {t('admin.crowdSec.configuration.retention')}
                            </p>
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
                    </section>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                        {(['clientIp', 'failure', 'deployment'] as const).map((item) => (
                            <section
                                key={item}
                                className="rounded-2xl border border-border bg-surface-raised p-4"
                            >
                                <p className={uiClassNames.themedTechnicalLabel}>
                                    {t(`admin.crowdSec.facts.${item}.label`)}
                                </p>
                                <p className="mt-2 text-sm font-extrabold text-ink">
                                    {t(`admin.crowdSec.facts.${item}.value`)}
                                </p>
                                <p className="mt-1.5 text-xs leading-relaxed text-muted">
                                    {t(`admin.crowdSec.facts.${item}.description`)}
                                </p>
                            </section>
                        ))}
                    </div>
                </>
            )}
        </>
    )
}
