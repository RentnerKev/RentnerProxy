import type { ReactNode } from 'react'

import { uiClassNames } from '../Styles/uiClassNames'

interface PageHeaderProps {
    readonly eyebrow: string
    readonly title: string
    readonly description: string
    readonly action?: ReactNode
}

export default function PageHeader({ action, description, eyebrow, title }: PageHeaderProps) {
    return (
        <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
            <div>
                <p className={uiClassNames.themedTechnicalLabel}>{eyebrow}</p>
                <h1 className="mt-[0.55rem] font-display text-[clamp(2rem,5vw,3.4rem)] leading-none tracking-[-0.045em] text-ink">
                    {title}
                </h1>
                <p className="mt-[0.9rem] max-w-[42rem] leading-[1.65] text-muted">{description}</p>
            </div>
            {action ? <div className="flex flex-wrap gap-3">{action}</div> : null}
        </header>
    )
}
