import { createFileRoute, Link } from '@tanstack/react-router'
import { getControllerHealth } from '../server/health.functions'

export const Route = createFileRoute('/')({
  loader: () => getControllerHealth(),
  component: FoundationScreen,
})

interface ServiceStatusProps {
  label: string
  detail: string
  value: string
  tone: 'positive' | 'warning'
}

function ServiceStatus({ label, detail, value, tone }: ServiceStatusProps) {
  const valueClassName =
    tone === 'positive'
      ? 'border-brand-400/20 bg-brand-400/10 text-brand-400'
      : 'border-amber-300/20 bg-amber-300/10 text-amber-300'
  const dotClassName = tone === 'positive' ? 'bg-brand-400' : 'bg-amber-300'

  return (
    <div className="flex flex-col gap-3 border-b border-white/10 py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div>
        <p className="text-sm font-bold text-white">{label}</p>
        <p className="mt-1 text-xs leading-5 text-mist-400">{detail}</p>
      </div>
      <p
        className={`inline-flex w-fit shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${valueClassName}`}
      >
        <span className={`size-1.5 rounded-full ${dotClassName}`} aria-hidden="true" />
        {value}
      </p>
    </div>
  )
}

function ConnectionTrace({ connected }: Readonly<{ connected: boolean }>) {
  const controllerNodeClassName = connected
    ? 'bg-brand-400 ring-brand-400/10'
    : 'bg-amber-300 ring-amber-300/10'

  return (
    <div className="relative mx-auto h-24 w-full max-w-sm xl:h-72 xl:w-32" aria-hidden="true">
      <span className="absolute top-1/2 right-10 left-10 h-px -translate-y-1/2 bg-white/15 xl:top-12 xl:bottom-12 xl:left-1/2 xl:h-auto xl:w-px xl:-translate-x-1/2 xl:translate-y-0" />

      <span className="absolute top-1/2 left-8 size-4 -translate-y-1/2 rounded-full border-[3px] border-navy-900 bg-brand-400 ring-8 ring-brand-400/10 xl:top-10 xl:left-1/2 xl:-translate-x-1/2 xl:translate-y-0" />
      <span
        className={`absolute top-1/2 right-8 size-4 -translate-y-1/2 rounded-full border-[3px] border-navy-900 ring-8 xl:top-auto xl:right-auto xl:bottom-10 xl:left-1/2 xl:-translate-x-1/2 xl:translate-y-0 ${controllerNodeClassName}`}
      />

      <span className="absolute top-[calc(50%+1.3rem)] left-4 text-[0.62rem] font-bold tracking-[0.14em] text-mist-400 uppercase xl:top-0 xl:left-1/2 xl:-translate-x-1/2">
        Web
      </span>
      <span className="absolute top-[calc(50%+1.3rem)] right-0 text-[0.62rem] font-bold tracking-[0.14em] text-mist-400 uppercase xl:top-auto xl:right-auto xl:bottom-0 xl:left-1/2 xl:-translate-x-1/2">
        Controller
      </span>

      <span className="absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-navy-900 text-xs text-mist-400 shadow-lg shadow-black/20">
        <span className="xl:hidden">→</span>
        <span className="hidden xl:inline">↓</span>
      </span>
    </div>
  )
}

function FoundationScreen() {
  const controller = Route.useLoaderData()
  const isConnected = controller.state === 'connected'

  return (
    <main className="relative isolate grid min-h-screen grid-rows-[auto_1fr_auto] overflow-x-hidden bg-navy-950 text-white">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,rgba(36,209,125,0.12),transparent_32rem)]"
        aria-hidden="true"
      />

      <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-5 px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
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
        <p className="text-right text-[0.65rem] font-bold tracking-[0.16em] text-mist-400 uppercase">
          Foundation · Local
        </p>
      </header>

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

        <ConnectionTrace connected={isConnected} />

        <div className="border-t border-white/10 xl:border-t-0" aria-live="polite">
          <h2 className="sr-only">Service status</h2>
          <ServiceStatus
            label="Web Application"
            detail="Serving this foundation screen"
            value="Running"
            tone="positive"
          />
          <ServiceStatus
            label="Controller"
            detail="Server-side health check"
            value={isConnected ? 'Connected' : 'Unavailable'}
            tone={isConnected ? 'positive' : 'warning'}
          />
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-7xl items-center gap-2 px-5 py-6 text-[0.62rem] font-semibold tracking-[0.12em] text-mist-400 uppercase sm:px-8 lg:px-12 lg:py-8">
        <span className="size-1.5 rounded-full bg-brand-500" aria-hidden="true" />
        Foundation status · Connection state is server-verified
      </footer>
    </main>
  )
}
