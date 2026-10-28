import { CheckCircle2, CircleDashed, CircleHelp, CircleMinus, CircleX } from 'lucide-react'
import { useId } from 'react'
import type { DomainCheckStageProps } from '../Types/domain-check-dialog.types.ts'

const statusStyles = {
    passed: 'border-success-text/20 bg-success-bg text-success-text',
    failed: 'border-danger-text/20 bg-danger-bg text-danger-text',
    unknown: 'border-warning-text/20 bg-amber-500/10 text-warning-text',
    not_applicable: 'border-border bg-surface-raised text-muted',
    pending: 'border-border bg-surface-raised text-muted',
}
const statusIcons = {
    passed: CheckCircle2,
    failed: CircleX,
    unknown: CircleHelp,
    not_applicable: CircleMinus,
    pending: CircleDashed,
}

export default function DomainCheckStage({ stage }: DomainCheckStageProps) {
    const Icon = statusIcons[stage.status]
    const headingId = useId()
    return (
        <section
            aria-labelledby={headingId}
            className="grid min-w-0 content-start gap-3 rounded-xl border border-border bg-surface-subtle p-4"
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 id={headingId} className="m-0 text-sm font-extrabold text-ink-soft">
                    {stage.title}
                </h3>
                <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-bold ${statusStyles[stage.status]}`}
                >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    {stage.statusLabel}
                </span>
            </div>
            <p className="m-0 text-sm leading-relaxed text-muted">{stage.description}</p>
            {stage.advice ? (
                <p className="m-0 text-sm leading-relaxed text-ink-soft">{stage.advice}</p>
            ) : null}
            {stage.addresses.length ? (
                <ul className="m-0 grid list-none gap-1 p-0 font-mono text-xs text-ink-soft">
                    {stage.addresses.map((address) => (
                        <li className="break-all" key={address}>
                            {address}
                        </li>
                    ))}
                </ul>
            ) : null}
            {stage.detail ? (
                <p className="m-0 font-mono text-xs text-muted">{stage.detail}</p>
            ) : null}
        </section>
    )
}
