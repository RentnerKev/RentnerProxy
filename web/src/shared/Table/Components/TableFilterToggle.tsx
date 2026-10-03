import type { TableFilterToggleProps } from '../Types/table-filter-toggle.types.ts'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { ListFilter } from 'lucide-react'

import { TOOLTIP_DEFAULT_PROPS } from '@/config/tooltip.config.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

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
                className={`inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring ${expanded || activeCount > 0 ? 'border-accent-border bg-accent-muted text-accent-ring' : 'border-border-strong bg-surface-raised text-muted hover:border-accent-border hover:text-accent-ring'}`}
            >
                <ListFilter aria-hidden="true" className="size-5" />
            </button>
        </CustomTooltip>
    )
}
