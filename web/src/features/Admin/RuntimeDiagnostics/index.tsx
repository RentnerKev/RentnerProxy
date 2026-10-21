import { Download, LoaderCircle } from 'lucide-react'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRuntimeSupportDownloadLogic from './Hooks/useRuntimeSupportDownloadLogic.ts'
import type { RuntimeSupportDownloadProps } from './Types/runtime-support-download.types.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function RuntimeSupportDownload(props: RuntimeSupportDownloadProps) {
    const { state, handler } = useRuntimeSupportDownloadLogic(props)
    const { t } = useTranslationStore()
    if (!state.canExport) return null

    return (
        <>
            <CustomTooltip
                collisionPadding={10}
                disabledTrigger={state.isExporting}
                content={
                    <div className="grid gap-1 text-left">
                        <p className="m-0 font-extrabold">
                            {t(
                                state.isExporting
                                    ? 'admin.runtimeDiagnostics.downloading'
                                    : 'admin.runtimeDiagnostics.download',
                            )}
                        </p>
                        <p className="m-0 leading-relaxed text-muted">
                            {t('admin.runtimeDiagnostics.privacy')}
                        </p>
                    </div>
                }
            >
                <button
                    type="button"
                    className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-xl border border-border-strong bg-surface-raised text-muted transition-colors enabled:hover:border-accent-border enabled:hover:bg-surface-hover enabled:hover:text-accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55 motion-reduce:transition-none"
                    aria-label={t(
                        state.isExporting
                            ? 'admin.runtimeDiagnostics.downloading'
                            : 'admin.runtimeDiagnostics.download',
                    )}
                    aria-busy={state.isExporting}
                    disabled={state.isExporting}
                    onClick={handler.handleDownload}
                >
                    {state.isExporting ? (
                        <LoaderCircle
                            aria-hidden="true"
                            className="size-5 animate-spin motion-reduce:animate-none"
                        />
                    ) : (
                        <Download aria-hidden="true" className="size-5" />
                    )}
                </button>
            </CustomTooltip>
            <output aria-live="polite" className="sr-only">
                {state.feedback
                    ? t(
                          `admin.runtimeDiagnostics.${state.feedback === 'failed' ? 'downloadFailed' : state.feedback === 'partial' ? 'downloadPartial' : 'downloadComplete'}`,
                      )
                    : null}
            </output>
            {state.feedback === 'failed' || state.feedback === 'partial' ? (
                <PageAlert
                    severity={state.feedback === 'failed' ? 'error' : 'warning'}
                    title={t('admin.runtimeDiagnostics.title')}
                    description={t(
                        state.feedback === 'failed'
                            ? 'admin.runtimeDiagnostics.downloadFailed'
                            : 'admin.runtimeDiagnostics.downloadPartial',
                    )}
                    action={
                        state.feedback === 'failed' ? (
                            <button
                                type="button"
                                className={buttonClassName('secondary')}
                                onClick={handler.handleDownload}
                                disabled={state.isExporting}
                            >
                                {t('common.retry')}
                            </button>
                        ) : undefined
                    }
                />
            ) : null}
        </>
    )
}
