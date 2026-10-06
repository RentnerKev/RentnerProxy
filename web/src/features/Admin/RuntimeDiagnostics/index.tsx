import { Download } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useRuntimeSupportDownloadLogic from './Hooks/useRuntimeSupportDownloadLogic.ts'
import type { RuntimeSupportDownloadProps } from './Types/runtime-support-download.types.ts'

export default function RuntimeSupportDownload(props: RuntimeSupportDownloadProps) {
    const { state, handler } = useRuntimeSupportDownloadLogic(props)
    const { t } = useTranslationStore()
    if (!state.canExport) return null

    return (
        <section
            aria-label={t('admin.runtimeDiagnostics.title')}
            className="mb-4 rounded-xl border border-border bg-surface-raised p-4"
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-3xl text-sm text-ink-soft" id="runtime-support-privacy">
                    {t('admin.runtimeDiagnostics.privacy')}
                </p>
                <button
                    type="button"
                    className="inline-flex min-h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border-strong px-4 py-2 text-sm font-bold text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring disabled:cursor-not-allowed disabled:opacity-55"
                    aria-describedby="runtime-support-privacy"
                    aria-busy={state.isExporting}
                    disabled={state.isExporting}
                    onClick={handler.handleDownload}
                >
                    <Download aria-hidden="true" className="size-4" />
                    {t(
                        state.isExporting
                            ? 'admin.runtimeDiagnostics.downloading'
                            : 'admin.runtimeDiagnostics.download',
                    )}
                </button>
            </div>
            <output aria-live="polite" className="mt-2 block text-sm text-ink-soft">
                {state.feedback
                    ? t(
                          `admin.runtimeDiagnostics.${state.feedback === 'failed' ? 'downloadFailed' : state.feedback === 'partial' ? 'downloadPartial' : 'downloadComplete'}`,
                      )
                    : null}
            </output>
        </section>
    )
}
