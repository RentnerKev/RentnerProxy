import { uiClassNames } from '../Styles/uiClassNames'
import type { AuthShellProps } from './Types/auth-shell.types'

export default function AuthShell({
    children,
    description,
    eyebrow,
    footer,
    title,
}: AuthShellProps) {
    return (
        <main
            data-theme="light"
            className="relative grid min-h-screen overflow-x-hidden bg-[#f7faf8] text-navy-900 shell:grid-cols-[minmax(25rem,44vw)_minmax(28rem,1fr)]"
        >
            <section
                className="relative isolate z-10 flex h-full min-h-[25rem] flex-col justify-between overflow-hidden bg-[linear-gradient(180deg,rgb(2_10_11_/_8%),rgb(2_10_11_/_66%)),url('/login-panel-background-v1.png')] bg-cover bg-center p-6 pb-24 text-white sm:pb-28 shell:min-h-screen shell:p-[clamp(2rem,5vw,4rem)]"
                aria-label="RentnerProxy"
            >
                <div
                    className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_72%_45%,rgb(48_238_97_/_12%),transparent_18rem)]"
                    aria-hidden="true"
                />
                <img
                    src="/rentnerproxy-logo.png"
                    alt="RentnerProxy"
                    width={640}
                    height={640}
                    className="h-auto w-[min(15rem,58vw)] self-center object-contain drop-shadow-[0_18px_30px_rgb(0_0_0_/_32%)] sm:w-72 shell:w-[clamp(16rem,22vw,20rem)] shell:self-start"
                />
                <div className="max-w-[34rem] py-10 pb-6">
                    <p className={uiClassNames.technicalLabel}>Secure control plane</p>
                    <p className="mt-3 mb-0 max-w-[30rem] font-display text-[clamp(2rem,5vw,4rem)] leading-[0.96] tracking-[-0.045em] text-white">
                        Your infrastructure stays yours. Access starts here.
                    </p>
                </div>
                <div className="flex h-5 w-[min(24rem,80%)] items-center gap-0" aria-hidden="true">
                    <span className="h-px flex-1 bg-brand-500/48" />
                    <span className="size-[0.65rem] shrink-0 rounded-full border-2 border-navy-950 bg-brand-500 shadow-[0_0_0_4px_rgb(48_238_97_/_14%)]" />
                    <span className="ml-[28%] size-[0.65rem] shrink-0 rounded-full border-2 border-navy-950 bg-brand-500 shadow-[0_0_0_4px_rgb(48_238_97_/_14%)]" />
                    <span className="ml-[28%] size-[0.65rem] shrink-0 rounded-full border-2 border-navy-950 bg-brand-500 shadow-[0_0_0_4px_rgb(48_238_97_/_14%)]" />
                    <span className="h-px flex-1 bg-brand-500/48" />
                </div>
                <p className="mt-4 mb-0 text-[0.7rem] font-bold tracking-[0.1em] text-mist-400 uppercase">
                    Self-hosted · Server-verified · Open source
                </p>
                <img
                    src="/login-panel-wave-mobile.svg"
                    alt=""
                    width={1440}
                    height={120}
                    className="pointer-events-none absolute right-0 -bottom-px left-0 z-20 h-20 w-full sm:h-24 shell:hidden"
                    aria-hidden="true"
                />
                <img
                    src="/login-panel-wave-desktop.svg"
                    alt=""
                    width={120}
                    height={1440}
                    className="pointer-events-none absolute top-0 right-0 bottom-0 z-20 hidden h-full w-28 shell:block"
                    aria-hidden="true"
                />
            </section>

            <section className="grid place-items-center bg-[radial-gradient(circle_at_95%_5%,rgb(48_238_97_/_13%),transparent_15rem),#f7faf8] p-6 py-10 shell:min-h-screen shell:p-12">
                <div className="w-[min(100%,31rem)] rounded-3xl border border-[rgb(6_18_15_/_12%)] bg-[rgb(255_255_255_/_94%)] p-[clamp(1.35rem,5vw,2.5rem)] shadow-[0_24px_70px_rgb(2_10_11_/_10%)] [&_a]:rounded [&_a]:font-bold [&_a]:text-brand-700 [&_a]:underline-offset-[0.2em] [&_a:hover]:text-navy-900">
                    <header>
                        <p className={uiClassNames.themedTechnicalLabel}>{eyebrow}</p>
                        <h1 className="mt-3 mb-0 font-display text-[clamp(2rem,6vw,3rem)] leading-none tracking-[-0.045em]">
                            {title}
                        </h1>
                        <p className="mt-4 mb-0 leading-[1.65] text-[#52665c]">{description}</p>
                    </header>
                    {children}
                    {footer ? (
                        <footer className="mt-6 border-t border-[rgb(6_18_15_/_10%)] pt-5 text-sm text-[#52665c]">
                            {footer}
                        </footer>
                    ) : null}
                </div>
            </section>
        </main>
    )
}

export type { AuthShellProps } from './Types/auth-shell.types'
