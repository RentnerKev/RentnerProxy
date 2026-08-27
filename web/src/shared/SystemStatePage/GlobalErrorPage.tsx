import type { ErrorComponentProps } from '@tanstack/react-router'
import { Link, useRouter } from '@tanstack/react-router'

import SystemStatePage from './Components/SystemStatePage'

export default function GlobalErrorPage({ reset }: ErrorComponentProps) {
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
