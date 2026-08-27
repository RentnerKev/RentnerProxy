import type { ServiceStatusProps } from '../Types/foundation-status.types'

export default function ServiceStatus({ detail, label, tone, value }: ServiceStatusProps) {
    const valueClassName =
        tone === 'positive'
            ? 'border-brand-400/20 bg-brand-400/10 text-brand-400'
            : 'border-amber-300/20 bg-amber-300/10 text-amber-300'
    const dotClassName = tone === 'positive' ? 'bg-brand-400' : 'bg-amber-300'

    return (
        <div className="flex flex-col gap-3 border-b border-white/10 py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
            <div>
                <p className="text-sm font-bold text-white">{label}</p>
                <p className="mt-1 text-xs leading-5 text-mist-400">{detail}</p>
            </div>
            <p
                className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${valueClassName}`}
            >
                <span className={`size-1.5 rounded-full ${dotClassName}`} aria-hidden="true" />
                {value}
            </p>
        </div>
    )
}
