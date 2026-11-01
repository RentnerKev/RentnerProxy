import BrandRasterImage from '@/shared/Branding/BrandRasterImage.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function LoadingPage() {
    const { t } = useTranslationStore()

    return (
        <main className="relative isolate grid min-h-svh grid-rows-[auto_1fr_auto] overflow-hidden bg-navy-950 text-white">
            <div
                className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(90deg,rgb(2_10_11_/_96%),rgb(2_10_11_/_26%)),url('/login-panel-background-v1.png')] bg-cover bg-center"
                aria-hidden="true"
            />
            <span
                className="pointer-events-none absolute inset-0 -z-10 bg-[var(--accent)] opacity-0 mix-blend-color group-data-[accent-custom=true]:opacity-100 [-webkit-mask-image:url('/login-panel-background-v1-accent-mask.png')] [mask-image:url('/login-panel-background-v1-accent-mask.png')] [-webkit-mask-position:center] [mask-position:center] [-webkit-mask-repeat:no-repeat] [mask-repeat:no-repeat] [-webkit-mask-size:cover] [mask-size:cover]"
                aria-hidden="true"
            />

            <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-5 px-6 py-5 sm:px-8 lg:px-12 lg:py-7">
                <BrandRasterImage
                    asset="logo-long"
                    alt={t('common.appName')}
                    width={220}
                    height={80}
                    wrapperClassName="w-36 shrink-0 sm:w-48"
                />
                <p className="flex items-center gap-2 text-right font-mono text-[0.6rem] font-bold tracking-[0.14em] text-mist-300 uppercase sm:text-[0.65rem]">
                    <span
                        className="size-1.5 shrink-0 rounded-full bg-brand-500"
                        aria-hidden="true"
                    />
                    {t('system.loading.eyebrow')}
                </p>
            </header>

            <section className="mx-auto grid w-full max-w-7xl content-center items-center gap-5 px-6 py-4 sm:gap-8 sm:px-8 sm:py-8 shell:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] shell:gap-12 shell:py-10 lg:px-12">
                <div className="order-last mx-auto w-full max-w-xl pb-6 text-center shell:order-first shell:mx-0 shell:pb-10 shell:text-left">
                    <p className="font-display text-[clamp(2.25rem,5.2vw,4.5rem)] leading-[1.04] tracking-[-0.035em]">
                        {t('common.appName')}.
                    </p>
                    <h1 className="mt-1 font-display text-[clamp(2.25rem,5.2vw,4.5rem)] leading-[1.04] tracking-[-0.035em] text-brand-500">
                        {t('system.loading.title')}
                    </h1>
                    <div
                        className="relative mx-auto mt-5 h-1 w-full max-w-96 overflow-hidden rounded-full bg-brand-500/15 shell:mx-0"
                        aria-hidden="true"
                    >
                        <span className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-linear-to-r from-brand-700 via-brand-400 to-brand-500 motion-safe:animate-loading-progress motion-reduce:left-1/3" />
                    </div>
                    <output
                        aria-live="polite"
                        aria-atomic="true"
                        className="mt-5 block text-sm leading-7 text-mist-300 sm:text-base"
                    >
                        {t('system.loading.description')}
                    </output>
                </div>

                <BrandRasterImage
                    asset="logo"
                    alt=""
                    width={640}
                    height={640}
                    wrapperClassName="mx-auto w-[min(64vw,32svh,22rem)] drop-shadow-[0_24px_36px_rgb(0_0_0_/_30%)] shell:w-full shell:max-w-xl"
                />
            </section>

            <div className="pointer-events-none relative h-16 w-full sm:h-24" aria-hidden="true">
                <img
                    src="/login-panel-wave-mobile.svg"
                    alt=""
                    width={1440}
                    height={120}
                    className="absolute inset-0 size-full"
                />
                <span className="absolute inset-0 bg-brand-600 [-webkit-mask-image:url('/login-panel-wave-mobile-mask.svg')] [mask-image:url('/login-panel-wave-mobile-mask.svg')] [-webkit-mask-position:center] [mask-position:center] [-webkit-mask-repeat:no-repeat] [mask-repeat:no-repeat] [-webkit-mask-size:100%_100%] [mask-size:100%_100%]" />
            </div>
        </main>
    )
}
