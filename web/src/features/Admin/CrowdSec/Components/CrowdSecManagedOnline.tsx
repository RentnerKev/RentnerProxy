import { CheckboxInput, PasswordInput } from '@rentnerkev/inputs'
import { ExternalLink, Link2 } from 'lucide-react'

import { CROWDSEC_ENROLLMENT_KEY_MAX_LENGTH } from '../../../../config/crowdsec.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import FieldError from '../../../../shared/Forms/FieldError'
import type { CrowdSecPageLogic } from '../Types/crowdsec.types'

export default function CrowdSecManagedOnline({
    state,
    handler,
}: {
    readonly state: CrowdSecPageLogic['state']
    readonly handler: CrowdSecPageLogic['handler']
}) {
    const { t } = useTranslationStore()
    const busy = state.isSaving || state.isTesting || state.isEnrolling
    const activeManaged =
        state.configuration?.mode === 'managed' &&
        state.configuration.runtime?.mode === 'managed' &&
        state.configuration.synchronized
    const communityState = activeManaged
        ? (state.configuration?.runtime?.communityState ?? 'disabled')
        : 'disabled'
    const consoleState = activeManaged
        ? (state.configuration?.runtime?.consoleState ?? 'not_enrolled')
        : 'not_enrolled'
    const canEnroll =
        activeManaged &&
        state.communityEnabled &&
        state.configuration?.communityEnabled &&
        communityState === 'connected' &&
        consoleState !== 'connected' &&
        consoleState !== 'pending'

    return (
        <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-sm font-bold text-ink-soft">{t('admin.crowdSec.online.title')}</h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
                {t('admin.crowdSec.online.description')}
            </p>
            <label
                className="flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem] mt-4"
                htmlFor="crowdsec-community-enabled"
            >
                <CheckboxInput
                    id="crowdsec-community-enabled"
                    name="crowdsec-community-enabled"
                    type="checkbox"
                    checked={state.communityEnabled}
                    disabled={!state.canUpdate || busy}
                    onChange={(event) => handler.setCommunityEnabled(event.target.checked)}
                />
                <span className="grid gap-[0.12rem]">
                    <span className="text-[0.78rem] text-ink-soft">
                        {t('admin.crowdSec.online.communityLabel')}
                    </span>
                    <span className="m-0 text-[0.76rem] leading-[1.45] text-muted">
                        {t('admin.crowdSec.online.communityHint')}
                    </span>
                </span>
            </label>
            <p className="mt-3 text-xs text-muted" aria-live="polite">
                {t('admin.crowdSec.online.communityStatus')}:{' '}
                <span
                    className={communityState === 'degraded' ? 'text-danger-text' : 'text-ink-soft'}
                >
                    {t(`admin.crowdSec.online.communityStates.${communityState}`)}
                </span>
            </p>

            <div className="mt-5 rounded-xl border border-border bg-surface-raised p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 className="text-sm font-bold text-ink-soft">
                            {t('admin.crowdSec.online.consoleTitle')}
                        </h4>
                        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                            {t('admin.crowdSec.online.consoleDescription')}
                        </p>
                    </div>
                    <a
                        className="inline-flex items-center gap-1 text-xs font-bold text-accent-ring underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
                        href="https://app.crowdsec.net/security-engines"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t('admin.crowdSec.online.openConsole')}
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                </div>
                <p className="mt-3 text-xs text-muted" aria-live="polite">
                    {t('admin.crowdSec.online.consoleStatus')}:{' '}
                    <span
                        className={
                            consoleState === 'degraded' ? 'text-danger-text' : 'text-ink-soft'
                        }
                    >
                        {t(`admin.crowdSec.online.consoleStates.${consoleState}`)}
                    </span>
                </p>
                {consoleState === 'pending' ? (
                    <p className="mt-2 text-xs leading-relaxed text-warning-text">
                        {t('admin.crowdSec.online.acceptEnrollment')}
                    </p>
                ) : null}
                {canEnroll ? (
                    <div className="mt-4 flex flex-wrap items-end gap-3">
                        <div className="grid gap-[0.45rem] min-w-56 flex-1">
                            <label
                                className="text-[0.82rem] font-[750] text-ink-soft"
                                htmlFor="crowdsec-enrollment-key"
                            >
                                {t('admin.crowdSec.online.enrollmentKey')}
                            </label>
                            <PasswordInput
                                id="crowdsec-enrollment-key"
                                name="crowdsec-enrollment-key"
                                type="password"
                                value={state.enrollmentKey}
                                disabled={!state.canUpdate || busy}
                                autoComplete="new-password"
                                maxLength={CROWDSEC_ENROLLMENT_KEY_MAX_LENGTH}
                                placeholder={t('admin.crowdSec.online.enrollmentPlaceholder')}
                                aria-invalid={state.fieldErrors.enrollmentKey ? true : undefined}
                                aria-describedby="crowdsec-enrollment-hint crowdsec-enrollment-error"
                                onChange={(event) => handler.setEnrollmentKey(event.target.value)}
                            />
                            <FieldError
                                id="crowdsec-enrollment-error"
                                errors={
                                    state.fieldErrors.enrollmentKey
                                        ? [state.fieldErrors.enrollmentKey]
                                        : []
                                }
                            />
                        </div>
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            disabled={!state.canUpdate || busy || state.enrollmentKey.length === 0}
                            onClick={handler.enrollConsole}
                        >
                            <Link2 aria-hidden="true" className="size-4" />
                            {t(
                                state.isEnrolling
                                    ? 'admin.crowdSec.online.enrolling'
                                    : 'admin.crowdSec.online.enroll',
                            )}
                        </button>
                        <p
                            id="crowdsec-enrollment-hint"
                            className="w-full text-xs leading-relaxed text-muted"
                        >
                            {t('admin.crowdSec.online.enrollmentHint')}
                        </p>
                    </div>
                ) : !state.communityEnabled || !activeManaged ? (
                    <p className="mt-3 text-xs leading-relaxed text-muted">
                        {t('admin.crowdSec.online.enableFirst')}
                    </p>
                ) : null}
            </div>
        </div>
    )
}
