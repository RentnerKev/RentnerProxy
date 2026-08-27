import type { ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'

interface SystemStatePageProps {
  code: string
  eyebrow: string
  title: string
  description: string
  imageSrc: string
  announce?: boolean
  children: ReactNode
}

function SystemStatePage({
  code,
  eyebrow,
  title,
  description,
  imageSrc,
  announce = false,
  children,
}: SystemStatePageProps) {
  return (
    <main className="relative isolate grid min-h-screen grid-rows-[auto_1fr_auto] overflow-x-hidden bg-navy-950 text-white">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_72%_42%,rgba(36,209,125,0.1),transparent_34rem)]"
        aria-hidden="true"
      />

      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-3 rounded-xl text-sm font-bold tracking-[0.04em] text-white transition-colors hover:text-brand-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
          aria-label="RentnerProxy home"
        >
          <img
            src="/rentnerproxy-logo.png"
            alt=""
            width={36}
            height={36}
            className="size-9 object-contain"
          />
          <span>RentnerProxy</span>
        </Link>
        <p className="text-[0.65rem] font-bold tracking-[0.16em] text-mist-400 uppercase">
          System response
        </p>
      </header>

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
          </div>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">{children}</div>
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

      <footer className="mx-auto flex w-full max-w-7xl items-center gap-2 px-5 py-6 text-[0.62rem] font-semibold tracking-[0.12em] text-mist-400 uppercase sm:px-8 lg:px-12 lg:py-8">
        <span className="size-1.5 rounded-full bg-brand-500" aria-hidden="true" />
        Safe route recovery
      </footer>
    </main>
  )
}

export function NotFoundPage() {
  return (
    <SystemStatePage
      code="404"
      eyebrow="Route unavailable"
      title="Page not found."
      description="The page you are looking for does not exist or may have moved. The RentnerProxy foundation is still running."
      imageSrc="/system-not-found-v1-960.webp"
    >
      <Link
        to="/"
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-navy-950 transition-colors hover:bg-brand-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
      >
        Back to home
        <span aria-hidden="true">→</span>
      </Link>
    </SystemStatePage>
  )
}

export function GlobalErrorPage({ reset }: ErrorComponentProps) {
  const router = useRouter()

  function handleRetry() {
    reset()
    void router.invalidate()
  }

  return (
    <SystemStatePage
      code="500"
      eyebrow="Unexpected interruption"
      title="Something went wrong."
      description="An unexpected error interrupted this page. Try again, or return to the homepage to continue from a safe route."
      imageSrc="/system-error-v1-960.webp"
      announce
    >
      <button
        type="button"
        className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-navy-950 transition-colors hover:bg-brand-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
        onClick={handleRetry}
      >
        Try again
      </button>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-bold text-white transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
      >
        Back to home
      </Link>
    </SystemStatePage>
  )
}
