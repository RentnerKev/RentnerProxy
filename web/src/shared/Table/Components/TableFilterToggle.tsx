import { ListFilter } from 'lucide-react'

import useTranslationStore from '../../../language/useTranslationStore'
import { Tooltip } from '../../Tooltip'

interface TableFilterToggleProps {
    readonly contentId: string
    readonly expanded: boolean
    readonly onToggle: () => void
    readonly activeCount?: number
}

export default function TableFilterToggle({
    contentId,
    expanded,
    onToggle,
    activeCount = 0,
}: TableFilterToggleProps) {
    const { t } = useTranslationStore()
    return (
        <Tooltip content={t('table.filters')}>
            <button
                type="button"
                aria-label={t('table.filters')}
                aria-expanded={expanded}
                aria-controls={contentId}
                onClick={onToggle}
                className={`inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${expanded || activeCount > 0 ? 'border-brand-600/40 bg-success-bg text-brand-text' : 'border-border-strong bg-surface-raised text-muted hover:border-brand-600 hover:text-brand-text'}`}
            >
                <ListFilter aria-hidden="true" className="size-5" />
            </button>
        </Tooltip>
    )
}
