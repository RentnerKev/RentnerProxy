import type { ReactNode } from 'react'

import { uiClassNames } from '../../Styles/uiClassNames'

interface TableLayoutProps {
    readonly titleId: string
    readonly title: string
    readonly eyebrow: string
    readonly description?: string | undefined
    readonly toolbar?: ReactNode
    readonly filterToggle?: ReactNode
    readonly filters?: ReactNode
    readonly pagination?: ReactNode
    readonly children: ReactNode
}

export default function TableLayout({
    titleId,
    title,
    eyebrow,
    description,
    toolbar,
    filterToggle,
    filters,
    pagination,
    children,
}: TableLayoutProps) {
    return (
        <section aria-labelledby={titleId} className={uiClassNames.table.panel}>
            <header className="flex flex-col gap-4 border-b border-border px-[1.15rem] py-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0">
                    <p className={uiClassNames.themedTechnicalLabel}>{eyebrow}</p>
                    <h2 id={titleId} className="mt-[0.4rem] text-xl text-ink-soft">
                        {title}
                    </h2>
                    {description ? (
                        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
                            {description}
                        </p>
                    ) : null}
                </div>
                <div className="flex min-w-0 items-end gap-2">
                    <div className="min-w-0 flex-1">{toolbar}</div>
                    {filterToggle}
                </div>
            </header>
            {filters}
            {children}
            {pagination}
        </section>
    )
}
