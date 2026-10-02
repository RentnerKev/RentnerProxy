import type { ReactNode } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

interface TableFiltersProps {
    readonly children: (resetButton: ReactNode) => ReactNode
    readonly contentId: string
    readonly expanded: boolean
    readonly activeCount?: number
    readonly onReset?: () => void
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
            <div className="border-b border-border px-[1.15rem] py-4">
                {children(
                    activeCount > 0 && onReset ? (
                        <button
                            type="button"
                            onClick={onReset}
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring justify-self-start self-end whitespace-nowrap"
                        >
                            {t('table.resetFilters')}
                        </button>
                    ) : null,
                )}
            </div>
        </div>
    )
}
