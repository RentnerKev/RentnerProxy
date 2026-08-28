import type { ReactNode } from 'react'

interface ContentStateProps {
    readonly title: string
    readonly description: string
    readonly action?: ReactNode
    readonly busy?: boolean
}

export default function ContentState({
    action,
    busy = false,
    description,
    title,
}: ContentStateProps) {
    return (
        <div
            className="grid min-h-64 place-items-center content-center gap-[0.65rem] rounded-2xl border border-dashed border-border-strong bg-surface p-8 text-center"
            role={busy ? 'status' : undefined}
            aria-live="polite"
        >
            <span
                className={`size-3 rounded-full bg-brand-500 shadow-[0_0_0_6px_rgb(48_238_97_/_15%)] motion-reduce:animate-none ${busy ? 'animate-pulse' : ''}`}
                aria-hidden="true"
            />
            <h2 className="mt-[0.65rem] text-[1.15rem] text-ink-soft">{title}</h2>
            <p className="m-0 max-w-[30rem] leading-[1.55] text-muted">{description}</p>
            {action ? <div>{action}</div> : null}
        </div>
    )
}
