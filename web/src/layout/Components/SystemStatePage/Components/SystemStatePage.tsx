import useTranslationStore from '../../../../language/useTranslationStore'
import ApplicationFooter from '../../ApplicationShell/Components/ApplicationFooter'
import ApplicationHeader from '../../ApplicationShell/Components/ApplicationHeader'
import type { SystemStatePageProps } from '../Types/system-state-page.types'

const imageAccentMasks: Readonly<Record<string, string>> = {
    '/system-error-v1-960.webp': '/system-error-v1-960-accent-mask.png',
    '/system-not-found-v1-960.webp': '/system-not-found-v1-960-accent-mask.png',
}

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
    const accentMaskSrc = imageAccentMasks[imageSrc]

    return (
        <main className="relative isolate grid min-h-screen grid-rows-[auto_1fr_auto] overflow-x-hidden bg-navy-950 text-white">
            <div
                className="pointer-events-none absolute inset-0 -z-10"
                style={{
                    background:
                        'radial-gradient(circle at 72% 42%, rgb(var(--accent-rgb) / 10%), transparent 34rem)',
                }}
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
                    <span className="relative isolate block aspect-square w-full max-w-120">
                        <img
                            src={imageSrc}
                            alt=""
                            width={960}
                            height={960}
                            className="relative z-0 block size-full object-contain"
                        />
                        {accentMaskSrc ? (
                            <span
                                className="pointer-events-none absolute inset-0 z-10 bg-[var(--accent)] opacity-0 mix-blend-color group-data-[accent-custom=true]:opacity-100 [-webkit-mask-position:center] [mask-position:center] [-webkit-mask-repeat:no-repeat] [mask-repeat:no-repeat] [-webkit-mask-size:100%_100%] [mask-size:100%_100%]"
                                style={{
                                    maskImage: `url('${accentMaskSrc}')`,
                                    WebkitMaskImage: `url('${accentMaskSrc}')`,
                                }}
                                aria-hidden="true"
                            />
                        ) : null}
                    </span>
                </div>
            </section>

            <ApplicationFooter label={t('system.recovery')} />
        </main>
    )
}
