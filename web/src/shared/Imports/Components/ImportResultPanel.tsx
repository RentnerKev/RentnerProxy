import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ImportItemDetails from './ImportItemDetails/index.tsx'
import type { ImportResultPanelProps } from '../Types/import-panels.types.ts'

export default function ImportResultPanel({ result, sourceLabel }: ImportResultPanelProps) {
    const { t } = useTranslationStore()
    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-live="polite"
        >
            <h2 className="text-lg font-extrabold text-ink">{t('admin.npmImport.resultTitle')}</h2>
            <p className="mt-2 text-sm text-ink-soft">
                {sourceLabel ? <>{sourceLabel}: </> : null}
                {t('admin.npmImport.resultSummary', {
                    imported: result.imported,
                    skipped: result.skipped,
                    failed: result.failed,
                    runtime: t(`admin.npmImport.runtime.${result.runtimeStatus}`),
                })}
            </p>
            <details className="mt-4">
                <summary className="cursor-pointer font-bold text-ink">
                    {t('admin.npmImport.details')}
                </summary>
                <ul className="mt-2">
                    {result.items.map((item) => (
                        <ImportItemDetails key={`${item.kind}:${item.sourceId}`} item={item} />
                    ))}
                </ul>
            </details>
        </section>
    )
}
