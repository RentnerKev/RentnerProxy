import { Link } from '@tanstack/react-router'

import useTranslationStore from '../../../../language/useTranslationStore'

import type { ApplicationHeaderProps } from '../Types/application-shell.types'

export default function ApplicationHeader({ label }: ApplicationHeaderProps) {
    const { t } = useTranslationStore()
    return (
        <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-5 px-5 py-6 sm:px-8 lg:px-12 lg:py-8">
            <Link
                to="/"
                className="inline-flex items-center gap-3 rounded-xl text-sm font-bold tracking-[0.04em] text-white transition-colors hover:text-brand-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
                aria-label={t('shell.home')}
            >
                <img
                    src="/rentnerproxy-logo.png"
                    alt=""
                    width={36}
                    height={36}
                    className="size-9 object-contain"
                />
                <span>{t('common.appName')}</span>
            </Link>
            <p className="text-right text-[0.65rem] font-bold tracking-[0.16em] text-mist-400 uppercase">
                {label}
            </p>
        </header>
    )
}
