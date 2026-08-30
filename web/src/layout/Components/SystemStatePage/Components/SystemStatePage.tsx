import useTranslationStore from '../../../../language/useTranslationStore'
import ApplicationFooter from '../../ApplicationShell/Components/ApplicationFooter'
import ApplicationHeader from '../../ApplicationShell/Components/ApplicationHeader'
import type { SystemStatePageProps } from '../Types/system-state-page.types'

export default function SystemStatePage({
    announce = false,
    children,
    code,
    description,
    details,
    eyebrow,
    imageSrc,
    title,
}: SystemStatePageProps) {
    const { t } = useTranslationStore()
    return (
        <main className="relative isolate grid min-h-screen grid-rows-[auto_1fr_auto] overflow-x-hidden bg-navy-950 text-white">
            <div
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_72%_42%,rgba(36,209,125,0.1),transparent_34rem)]"
                aria-hidden="true"
            />

            <ApplicationHeader label={t('system.response')} />

            <section className="mx-auto grid w-full max-w-7xl self-center gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(25rem,1.15fr)] lg:items-center lg:gap-16 lg:px-12">
                <div className="max-w-xl">
                    <p className="mb-6 flex items-center gap-3 text-[0.68rem] font-bold tracking-[0.18em] text-brand-400 uppercase">
                        <span className="h-px w-8 bg-brand-500" aria-hidden="true" />
                        {eyebrow}
                    </p>

                    <div role={announce ? 'alert' : undefined}>
                        <p className="font-display text-6xl leading-none font-semibold tracking-[-0.06em] text-white sm:text-7xl">
                            {code}
                        </p>
                        <h1 className="mt-5 font-display text-4xl leading-[1.02] font-semibold tracking-[-0.045em] text-white sm:text-5xl">
                            {title}
                        </h1>
                        <p className="mt-6 max-w-lg text-base leading-7 text-mist-400 sm:text-lg">
                            {description}
                        </p>
                        {details}
                    </div>

                    <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        {children}
                    </div>
                </div>

                <div className="relative order-first mx-auto flex w-full max-w-xl items-center justify-center overflow-hidden rounded-[2rem] border border-white/10 bg-navy-900/80 p-4 shadow-2xl shadow-black/20 sm:p-7 lg:order-last">
                    <div
                        className="absolute inset-x-12 bottom-8 h-24 rounded-full bg-brand-500/10 blur-3xl"
                        aria-hidden="true"
                    />
                    <img
                        src={imageSrc}
                        alt=""
                        width={960}
                        height={960}
                        className="relative h-auto w-full max-w-[30rem] object-contain"
                    />
                </div>
            </section>

            <ApplicationFooter label={t('system.recovery')} />
        </main>
    )
}
