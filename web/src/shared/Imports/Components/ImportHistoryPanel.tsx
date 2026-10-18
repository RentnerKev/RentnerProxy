import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ImportItemDetails from './ImportItemDetails/index.tsx'
import type { ImportHistoryPanelProps } from '../Types/import-panels.types.ts'

export default function ImportHistoryPanel({
    history,
    showSource = false,
}: ImportHistoryPanelProps) {
    const { t } = useTranslationStore()
    return (
        <section className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface">
            <h2 className="text-lg font-extrabold text-ink">{t('admin.npmImport.history')}</h2>
            <ul className="mt-3 grid gap-2 text-sm text-ink-soft">
                {history.map((entry) => (
                    <li key={entry.runId}>
                        <details>
                            <summary className="cursor-pointer">
                                {showSource ? (
                                    <>
                                        {entry.sourceSchema.startsWith('npm')
                                            ? t('admin.migration.source.npm')
                                            : entry.sourceSchema.startsWith('zoraxy')
                                              ? t('admin.migration.source.zoraxy')
                                              : entry.sourceSchema.startsWith('rentnerproxy')
                                                ? t('admin.migration.source.rentnerproxy')
                                                : entry.sourceSchema}{' '}
                                        ·{' '}
                                    </>
                                ) : null}
                                {entry.imported} {t('admin.npmImport.imported')}, {entry.skipped}{' '}
                                {t('admin.npmImport.skipped')}, {entry.failed}{' '}
                                {t('admin.npmImport.failed')}
                                {' · '}
                                {t(`admin.npmImport.runtime.${entry.runtimeStatus}`)}
                            </summary>
                            <ul className="mt-2 pl-4">
                                {entry.items.map((item) => (
                                    <ImportItemDetails
                                        key={`${item.kind}:${item.sourceId}`}
                                        item={item}
                                    />
                                ))}
                            </ul>
                        </details>
                    </li>
                ))}
            </ul>
        </section>
    )
}
