import type { TableLayoutProps } from '../Types/table-layout.types.ts'

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
        <section
            aria-labelledby={titleId}
            className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-surface"
        >
            <header className="flex flex-col gap-4 border-b border-border px-[1.15rem] py-4 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0">
                    <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-accent-ring uppercase">
                        {eyebrow}
                    </p>
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
