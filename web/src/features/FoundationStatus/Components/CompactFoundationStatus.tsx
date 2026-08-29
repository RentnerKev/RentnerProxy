import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import type { FoundationStatusViewProps } from '../Types/foundation-status.types'

export default function CompactFoundationStatus({ services }: FoundationStatusViewProps) {
    return (
        <section
            className="grid gap-6 rounded-[1.25rem] border border-border bg-surface p-[clamp(1.25rem,4vw,2rem)] shadow-panel"
            aria-label="Foundation service status"
        >
            <div>
                <p className={uiClassNames.technicalLabel}>Connection map</p>
                <h2 className="mt-[0.6rem] text-[clamp(1.3rem,3vw,1.8rem)] tracking-[-0.025em] text-ink-soft">
                    Four services. One control path.
                </h2>
                <p className="mt-[0.65rem] max-w-[40rem] leading-[1.55] text-muted">
                    Each result is checked through the server boundary and refreshed every 30
                    seconds.
                </p>
            </div>
            <div className="grid gap-3 shell:grid-cols-4" aria-live="polite">
                {services.map((service, index) => (
                    <article
                        className="grid min-w-0 rounded-[0.9rem] border border-border bg-surface-raised p-4"
                        key={service.label}
                    >
                        <div className="flex items-center justify-between font-mono text-[0.65rem] text-muted-soft">
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <i
                                className={`size-[0.55rem] rounded-full ${service.tone === 'positive' ? 'bg-brand-500 shadow-[0_0_0_4px_rgb(48_238_97_/_14%)]' : 'bg-amber-500 shadow-[0_0_0_4px_rgb(245_158_11_/_12%)]'}`}
                                data-tone={service.tone}
                                aria-hidden="true"
                            />
                        </div>
                        <h3 className="mt-4 text-base text-ink">{service.label}</h3>
                        <p className="mt-[0.35rem] mb-4 text-[0.75rem] leading-[1.45] text-muted">
                            {service.detail}
                        </p>
                        <strong
                            className={`mt-auto text-[0.76rem] ${service.tone === 'positive' ? 'text-brand-text' : 'text-warning-text'}`}
                            data-tone={service.tone}
                        >
                            {service.value}
                        </strong>
                    </article>
                ))}
            </div>
        </section>
    )
}
