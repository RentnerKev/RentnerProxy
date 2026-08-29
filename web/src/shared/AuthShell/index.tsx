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
            className="relative grid min-h-screen overflow-hidden bg-[#f7faf8] text-navy-900 shell:grid-cols-[minmax(24rem,0.95fr)_minmax(30rem,1.05fr)]"
        >
            <section
                className="relative isolate flex min-h-[17rem] flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_85%_15%,rgb(48_238_97_/_18%),transparent_18rem),#020a0b] p-6 text-white shell:min-h-screen shell:p-[clamp(2rem,5vw,4rem)]"
                aria-label="RentnerProxy"
            >
                <div
                    className="absolute inset-0 -z-10 bg-[linear-gradient(rgb(255_255_255_/_4%)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255_/_4%)_1px,transparent_1px)] bg-[length:44px_44px] [mask-image:linear-gradient(to_bottom_right,black,transparent_78%)]"
                    aria-hidden="true"
                />
                <img
                    src="/rentnerproxy-logo-long.png"
                    alt="RentnerProxy"
                    width={430}
                    height={158}
                    className="h-auto w-[min(18rem,75vw)] object-contain object-left"
                />
                <div className="max-w-[34rem] py-10 pb-6">
                    <p className={uiClassNames.technicalLabel}>Secure control plane</p>
                    <p className="mt-3 mb-0 max-w-[28rem] font-display text-[clamp(1.8rem,5vw,3.6rem)] leading-[0.98] tracking-[-0.045em]">
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
            </section>

            <section className="grid place-items-center bg-[radial-gradient(circle_at_95%_5%,rgb(48_238_97_/_13%),transparent_15rem),#f7faf8] p-6 shell:p-12">
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
