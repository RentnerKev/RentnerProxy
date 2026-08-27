import type { ApplicationFooterProps } from '../Types/application-shell.types'

export default function ApplicationFooter({ label }: ApplicationFooterProps) {
    return (
        <footer className="mx-auto flex w-full max-w-7xl items-center gap-2 px-5 py-6 text-[0.62rem] font-semibold tracking-[0.12em] text-mist-400 uppercase sm:px-8 lg:px-12 lg:py-8">
            <span className="size-1.5 rounded-full bg-brand-500" aria-hidden="true" />
            {label}
        </footer>
    )
}
