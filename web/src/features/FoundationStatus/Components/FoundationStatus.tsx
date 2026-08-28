import ApplicationFooter from '../../../shared/ApplicationShell/Components/ApplicationFooter'
import ApplicationHeader from '../../../shared/ApplicationShell/Components/ApplicationHeader'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import ConnectionTrace from './ConnectionTrace'
import ServiceStatus from './ServiceStatus'
import type { FoundationStatusProps, ServiceStatusProps } from '../Types/foundation-status.types'

export default function FoundationStatus({ compact = false, health }: FoundationStatusProps) {
    const controllerConnected = health.controller.state === 'connected'
    const databaseConnected = health.database.state === 'connected'
    const redisConnected = health.redis.state === 'connected'
    const services: readonly ServiceStatusProps[] = [
        {
            label: 'Web Application',
            detail: 'Serving this foundation screen',
            value: 'Running',
            tone: 'positive',
        },
        {
            label: 'Controller',
            detail: 'Server-side health check',
            value: controllerConnected ? 'Connected' : 'Unavailable',
            tone: controllerConnected ? 'positive' : 'warning',
        },
        {
            label: 'Database',
            detail: 'Server-side PostgreSQL health check',
            value: databaseConnected ? 'Connected' : 'Unavailable',
            tone: databaseConnected ? 'positive' : 'warning',
        },
        {
            label: 'Redis',
            detail: 'Server-side Redis health check',
            value: redisConnected ? 'Connected' : 'Unavailable',
            tone: redisConnected ? 'positive' : 'warning',
        },
    ]

    if (compact) {
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

    return (
        <main className="relative isolate grid min-h-screen grid-rows-[auto_1fr_auto] overflow-x-hidden bg-navy-950 text-white">
            <div
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(36,209,125,0.12),transparent_32rem)]"
                aria-hidden="true"
            />

            <ApplicationHeader label="Foundation · Local" />

            <section
                className="mx-auto grid w-[calc(100%-2.5rem)] max-w-7xl self-center rounded-[2rem] border border-white/10 bg-navy-900/80 px-6 py-10 shadow-2xl shadow-black/20 sm:w-[calc(100%-4rem)] sm:px-9 sm:py-12 lg:px-12 lg:py-16 xl:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)] xl:items-center xl:gap-12"
                aria-labelledby="connection-title"
            >
                <div className="max-w-xl">
                    <p className="mb-6 flex items-center gap-3 text-[0.68rem] font-bold tracking-[0.18em] text-brand-400 uppercase">
                        <span className="h-px w-8 bg-brand-500" aria-hidden="true" />
                        Foundation status
                    </p>
                    <h1
                        id="connection-title"
                        className="max-w-lg font-display text-4xl leading-[0.96] font-semibold tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl"
                    >
                        Development Environment
                    </h1>
                    <p className="mt-7 max-w-md text-sm leading-7 text-mist-400 sm:text-base">
                        Local service readiness, verified through the server boundary.
                    </p>
                </div>

                <ConnectionTrace connected={controllerConnected} />

                <div className="border-t border-white/10 xl:border-t-0" aria-live="polite">
                    <h2 className="sr-only">Service status</h2>
                    {services.map((service) => (
                        <ServiceStatus key={service.label} {...service} />
                    ))}
                </div>
            </section>

            <ApplicationFooter label="Foundation status · Connection state is server-verified" />
        </main>
    )
}
