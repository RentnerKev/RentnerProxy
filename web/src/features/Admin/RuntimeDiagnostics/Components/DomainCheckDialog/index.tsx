import { ClipboardCopy, Globe, LoaderCircle, Play, RefreshCw, Square } from 'lucide-react'
import { CustomSelect } from '@rentnerkev/select/select'
import { Modal } from '@/shared/Modal/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import RuntimeSupportDownload from '../../index.tsx'
import DomainCheckStage from './Components/DomainCheckStage.tsx'
import useDomainCheckDialogLogic from './Hooks/useDomainCheckDialogLogic.ts'
import type { DomainCheckDialogProps } from './Types/domain-check-dialog.types.ts'

export default function DomainCheckDialog(props: DomainCheckDialogProps) {
    const { state, handler } = useDomainCheckDialogLogic(props)
    const { t } = useTranslationStore()
    return (
        <Modal
            open={props.open}
            onOpenChange={handler.handleOpenChange}
            title={t('admin.domainCheck.title')}
            description={t('admin.domainCheck.description')}
            size="lg"
            footer={
                <>
                    {state.canCheck ? (
                        <RuntimeSupportDownload permissions={props.permissions} />
                    ) : null}
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        disabled={!state.result || state.isPending}
                        onClick={handler.handleCopy}
                    >
                        <ClipboardCopy aria-hidden="true" className="size-4" />
                        {t('admin.domainCheck.copy')}
                    </button>
                    {state.isPending ? (
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={handler.handleCancel}
                        >
                            <Square aria-hidden="true" className="size-4" />
                            {t('admin.domainCheck.cancel')}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={buttonClassName('primary')}
                        onClick={handler.handleCheck}
                        disabled={!state.canCheck || state.isPending || !state.domain}
                        aria-busy={state.isPending}
                    >
                        {state.isPending ? (
                            <LoaderCircle
                                aria-hidden="true"
                                className="size-4 animate-spin motion-reduce:animate-none"
                            />
                        ) : state.result || state.error ? (
                            <RefreshCw aria-hidden="true" className="size-4" />
                        ) : (
                            <Play aria-hidden="true" className="size-4" />
                        )}
                        {t(
                            state.result || state.error
                                ? 'admin.domainCheck.runAgain'
                                : 'admin.domainCheck.run',
                        )}
                    </button>
                </>
            }
        >
            <div className="grid min-w-0 gap-5">
                <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised p-4">
                    <Globe aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-ring" />
                    <div className="grid gap-2 text-sm leading-relaxed text-muted">
                        <p className="m-0">{t('admin.domainCheck.observation')}</p>
                        <p className="m-0">{t('admin.domainCheck.probeNote')}</p>
                    </div>
                </div>
                {state.canCheck ? (
                    <CustomSelect
                        label={t('admin.domainCheck.domain')}
                        aria-label={t('admin.domainCheck.domain')}
                        options={state.domainOptions}
                        value={state.domain || null}
                        onValueChange={handler.handleDomainChange}
                        locale={state.selectLocale}
                    />
                ) : null}
                {!state.canCheck ? (
                    <p
                        role="alert"
                        className="m-0 rounded-xl border border-danger-text/20 bg-danger-bg p-4 text-sm text-danger-text"
                    >
                        {t('admin.domainCheck.permissionDenied')}
                    </p>
                ) : null}
                {state.error ? (
                    <p
                        role="alert"
                        className="m-0 rounded-xl border border-danger-text/20 bg-danger-bg p-4 text-sm leading-relaxed text-danger-text"
                    >
                        {state.error}
                    </p>
                ) : null}
                <output aria-live="polite" className="text-sm text-muted">
                    {state.isPending
                        ? t('admin.domainCheck.pending')
                        : state.notice ||
                          (state.checkedAt
                              ? t('admin.domainCheck.checkedAt', { time: state.checkedAt })
                              : null)}
                </output>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2" aria-busy={state.isPending}>
                    {state.stages.map((stage) => (
                        <DomainCheckStage key={stage.name} stage={stage} />
                    ))}
                </div>
                <div className="grid gap-1 text-xs leading-relaxed text-muted">
                    <p className="m-0">{t('admin.domainCheck.copyPrivacy')}</p>
                    <output aria-live="polite">{state.copyFeedback}</output>
                </div>
            </div>
        </Modal>
    )
}
