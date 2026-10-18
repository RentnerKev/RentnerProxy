import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ImportItemDetails from './ImportItemDetails/index.tsx'
import type { ImportPreviewPanelProps } from '../Types/import-panels.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function ImportPreviewPanel({
    preview,
    busy,
    help,
    onApply,
    onDiscard,
}: ImportPreviewPanelProps) {
    const { t } = useTranslationStore()
    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="npm-preview-title"
        >
            <h2 id="npm-preview-title" className="text-lg font-extrabold text-ink">
                {t('admin.npmImport.previewTitle')}
            </h2>
            <p className="mt-2 text-sm text-ink-soft">{help}</p>
            <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
                {Object.entries(preview.counts).map(([status, count]) => (
                    <span
                        key={status}
                        className="inline-flex items-center rounded-full border border-success-text/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text"
                    >
                        {count} {t(`admin.npmImport.status.${status}`)}
                    </span>
                ))}
            </div>
            <details className="mt-5" open>
                <summary className="cursor-pointer font-bold text-ink">
                    {t('admin.npmImport.details')}
                </summary>
                <ul className="mt-2 max-h-[32rem] overflow-y-auto">
                    {preview.items.map((item) => (
                        <ImportItemDetails key={`${item.kind}:${item.sourceId}`} item={item} />
                    ))}
                </ul>
            </details>
            <div className="mt-5 flex flex-wrap gap-3">
                <button
                    type="button"
                    className={buttonClassName('primary')}
                    disabled={busy !== null || preview.counts.ready + preview.counts.partial === 0}
                    onClick={() => void onApply()}
                >
                    {busy === 'apply' ? t('common.working') : t('admin.npmImport.apply')}
                </button>
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    disabled={busy !== null}
                    onClick={onDiscard}
                >
                    {t('common.cancel')}
                </button>
            </div>
        </section>
    )
}
