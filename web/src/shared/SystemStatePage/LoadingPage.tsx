import { Globe2, Server, ShieldCheck } from 'lucide-react'

import BrandRasterImage from '@/shared/Branding/BrandRasterImage.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

const connection = (
    <span className="relative h-px flex-1 overflow-hidden bg-brand-400/20">
        <span className="absolute inset-y-0 left-0 w-1/4 bg-linear-to-r from-transparent via-brand-300 to-transparent motion-safe:animate-loading-packet motion-reduce:left-[37.5%]" />
    </span>
)

export default function LoadingPage() {
    const { t } = useTranslationStore()

    return (
        <main className="relative isolate grid min-h-svh place-items-center overflow-hidden bg-navy-950 px-6 py-12 text-white">
            <div
                className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_38%,rgb(var(--accent-rgb)_/_12%),transparent_60%)]"
                aria-hidden="true"
            />
            <div
                className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(rgb(var(--accent-rgb)_/_5%)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--accent-rgb)_/_5%)_1px,transparent_1px)] bg-size-[4rem_4rem] mask-[radial-gradient(ellipse_at_center,black,transparent_70%)]"
                aria-hidden="true"
            />

            <section className="relative w-full max-w-md text-center">
                <div className="relative mx-auto grid size-60 place-items-center sm:size-72">
                    <span
                        className="pointer-events-none absolute inset-0 rounded-full border border-brand-400/10 shadow-[0_0_80px_rgb(var(--accent-rgb)_/_8%)]"
                        aria-hidden="true"
                    />
                    <BrandRasterImage
                        asset="logo"
                        alt={t('common.appName')}
                        width={640}
                        height={640}
                        wrapperClassName="w-[88%] drop-shadow-[0_16px_24px_rgb(0_0_0_/_30%)]"
                    />
                </div>

                <div className="mt-8">
                    <p className="font-mono text-[0.65rem] font-bold tracking-[0.22em] text-brand-400 uppercase">
                        {t('system.loading.eyebrow')}
                    </p>
                    <h1 className="mt-3 font-display text-4xl leading-tight tracking-[-0.025em] sm:text-5xl">
                        {t('system.loading.title')}
                    </h1>
                    <output
                        aria-live="polite"
                        aria-atomic="true"
                        className="mt-3 block text-sm leading-6 text-mist-300"
                    >
                        {t('system.loading.description')}
                    </output>
                </div>

                <div
                    className="mx-auto mt-8 flex w-64 max-w-full items-center gap-3"
                    aria-hidden="true"
                >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/3 text-mist-400">
                        <Globe2 className="size-4" />
                    </span>
                    {connection}
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-brand-400/30 bg-brand-500/10 text-brand-300 shadow-[0_0_24px_rgb(var(--accent-rgb)_/_10%)]">
                        <ShieldCheck className="size-5" />
                    </span>
                    {connection}
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/3 text-mist-400">
                        <Server className="size-4" />
                    </span>
                </div>
            </section>
        </main>
    )
}
