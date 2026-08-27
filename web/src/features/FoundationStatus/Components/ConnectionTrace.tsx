import type { ConnectionTraceProps } from '../Types/foundation-status.types'

export default function ConnectionTrace({ connected }: ConnectionTraceProps) {
    const controllerNodeClassName = connected
        ? 'bg-brand-400 ring-brand-400/10'
        : 'bg-amber-300 ring-amber-300/10'

    return (
        <div className="relative mx-auto h-24 w-full max-w-sm xl:h-72 xl:w-32" aria-hidden="true">
            <span className="absolute top-1/2 right-10 left-10 h-px -translate-y-1/2 bg-white/15 xl:top-12 xl:bottom-12 xl:left-1/2 xl:h-auto xl:w-px xl:-translate-x-1/2 xl:translate-y-0" />
            <span className="absolute top-1/2 left-8 size-4 -translate-y-1/2 rounded-full border-[3px] border-navy-900 bg-brand-400 ring-8 ring-brand-400/10 xl:top-10 xl:left-1/2 xl:-translate-x-1/2 xl:translate-y-0" />
            <span
                className={`absolute top-1/2 right-8 size-4 -translate-y-1/2 rounded-full border-[3px] border-navy-900 ring-8 xl:top-auto xl:right-auto xl:bottom-10 xl:left-1/2 xl:-translate-x-1/2 xl:translate-y-0 ${controllerNodeClassName}`}
            />
            <span className="absolute top-[calc(50%+1.3rem)] left-4 text-[0.62rem] font-bold tracking-[0.14em] text-mist-400 uppercase xl:top-0 xl:left-1/2 xl:-translate-x-1/2">
                Web
            </span>
            <span className="absolute top-[calc(50%+1.3rem)] right-0 text-[0.62rem] font-bold tracking-[0.14em] text-mist-400 uppercase xl:top-auto xl:right-auto xl:bottom-0 xl:left-1/2 xl:-translate-x-1/2 xl:translate-y-0">
                Controller
            </span>
            <span className="absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-navy-900 text-xs text-mist-400 shadow-lg shadow-black/20">
                <span className="xl:hidden">→</span>
                <span className="hidden xl:inline">↓</span>
            </span>
        </div>
    )
}
