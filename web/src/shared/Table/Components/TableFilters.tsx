import type { ReactNode } from 'react'

import useTranslationStore from '../../../language/useTranslationStore'
import { uiClassNames } from '../../Styles/uiClassNames'

interface TableFiltersProps {
    readonly children: ReactNode
    readonly contentId: string
    readonly expanded: boolean
    readonly activeCount?: number
    readonly onReset: () => void
}

export default function TableFilters({
    children,
    contentId,
    expanded,
    activeCount = 0,
    onReset,
}: TableFiltersProps) {
    const { t } = useTranslationStore()
    return (
        <div id={contentId} hidden={!expanded}>
            <div className="grid gap-3 border-b border-border px-[1.15rem] py-4">
                {children}
                {activeCount > 0 ? (
                    <button
                        type="button"
                        onClick={onReset}
                        className={`${uiClassNames.button.quiet} justify-self-start`}
                    >
                        {t('table.resetFilters')}
                    </button>
                ) : null}
            </div>
        </div>
    )
}
