import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ImportItemDetailsProps } from './Types/import-item-details.types.ts'
import useImportItemDetailsLogic from './Hooks/useImportItemDetailsLogic.ts'

export default function ImportItemDetails({ item }: ImportItemDetailsProps) {
    const { t } = useTranslationStore()
    const { state } = useImportItemDetailsLogic(item)
    return (
        <li
            key={`${item.kind}:${item.sourceId}`}
            className="border-b border-border py-3 last:border-0"
        >
            <div className="flex flex-wrap items-center gap-2">
                <strong className="min-w-0 max-w-full [overflow-wrap:anywhere] text-ink">
                    {item.label}
                </strong>
                <span className="text-xs text-muted">{t(`admin.npmImport.kind.${item.kind}`)}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-bold text-ink-soft">
                    {t(`admin.npmImport.status.${item.status}`)}
                </span>
                {'outcome' in item ? (
                    <span className="text-xs font-bold text-ink-soft">
                        {t(`admin.npmImport.${item.outcome}`)}
                    </span>
                ) : null}
            </div>
            {item.reasons.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">
                    {state.reasons.map(({ reason, text }) => (
                        <li key={reason}>{text}</li>
                    ))}
                </ul>
            ) : null}
        </li>
    )
}
