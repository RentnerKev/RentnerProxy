import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { ListFilter } from 'lucide-react'

import { TOOLTIP_DEFAULT_PROPS } from '../../../config/tooltip.config'
import useTranslationStore from '../../../language/useTranslationStore'

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
        <CustomTooltip {...TOOLTIP_DEFAULT_PROPS} content={t('table.filters')}>
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
        </CustomTooltip>
    )
}
