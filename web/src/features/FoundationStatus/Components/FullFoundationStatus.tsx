import useTranslationStore from '../../../language/useTranslationStore'
import ApplicationFooter from '../../../layout/Components/ApplicationShell/Components/ApplicationFooter'
import ApplicationHeader from '../../../layout/Components/ApplicationShell/Components/ApplicationHeader'
import type { FoundationStatusViewProps } from '../Types/foundation-status.types'
import ConnectionTrace from './ConnectionTrace'
import ServiceStatus from './ServiceStatus'

export default function FullFoundationStatus({
    controllerConnected,
    services,
}: FoundationStatusViewProps) {
    const { t } = useTranslationStore()
    return (
        <main className="relative isolate grid min-h-screen grid-rows-[auto_1fr_auto] overflow-x-hidden bg-navy-950 text-white">
            <div
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(36,209,125,0.12),transparent_32rem)]"
                aria-hidden="true"
            />

            <ApplicationHeader label={t('foundation.local')} />

            <section
                className="mx-auto grid w-[calc(100%-2.5rem)] max-w-7xl self-center rounded-[2rem] border border-white/10 bg-navy-900/80 px-6 py-10 shadow-2xl shadow-black/20 sm:w-[calc(100%-4rem)] sm:px-9 sm:py-12 lg:px-12 lg:py-16 xl:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)] xl:items-center xl:gap-12"
                aria-labelledby="connection-title"
            >
                <div className="max-w-xl">
                    <p className="mb-6 flex items-center gap-3 text-[0.68rem] font-bold tracking-[0.18em] text-brand-400 uppercase">
                        <span className="h-px w-8 bg-brand-500" aria-hidden="true" />
                        {t('foundation.status')}
                    </p>
                    <h1
                        id="connection-title"
                        className="max-w-lg font-display text-4xl leading-[0.96] font-semibold tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl"
                    >
                        {t('foundation.environment')}
                    </h1>
                    <p className="mt-7 max-w-md text-sm leading-7 text-mist-400 sm:text-base">
                        {t('foundation.environmentDescription')}
                    </p>
                </div>

                <ConnectionTrace connected={controllerConnected} />

                <div className="border-t border-white/10 xl:border-t-0" aria-live="polite">
                    <h2 className="sr-only">{t('foundation.serviceStatus')}</h2>
                    {services.map((service) => (
                        <ServiceStatus key={service.label} {...service} />
                    ))}
                </div>
            </section>

            <ApplicationFooter label={t('foundation.footer')} />
        </main>
    )
}
