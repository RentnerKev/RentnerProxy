import type { ErrorComponentProps } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'

import useTranslationStore from '../../../language/useTranslationStore'

import SystemStatePage from './Components/SystemStatePage'
import useGlobalErrorPageLogic from './Hooks/useGlobalErrorPageLogic'

export default function GlobalErrorPage({ error, reset }: ErrorComponentProps) {
    const { t } = useTranslationStore()
    const { retry, details } = useGlobalErrorPageLogic({ error, reset })

    return (
        <SystemStatePage
            code={String(details.status)}
            eyebrow={t('system.error.eyebrow')}
            title={t(`${details.translationKey}.title`)}
            description={t(`${details.translationKey}.description`)}
            imageSrc="/system-error-v1-960.webp"
            announce
            details={
                <div className="mt-6 rounded-2xl border border-brand-400/20 bg-white/5 p-4 sm:p-5">
                    <h2 className="text-sm font-bold text-white">{t('system.error.nextStep')}</h2>
                    <p className="mt-2 text-sm leading-6 text-mist-300">
                        {t(`${details.translationKey}.nextStep`)}
                    </p>
                    {details.command ? (
                        <pre
                            aria-label={t('system.error.command')}
                            className="mt-3 overflow-x-auto rounded-lg bg-navy-950 px-3 py-2 text-sm text-brand-300"
                        >
                            <code>{details.command}</code>
                        </pre>
                    ) : null}
                    <dl className="mt-4 grid gap-2 border-t border-white/10 pt-3 text-xs">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <dt className="text-mist-400">{t('system.error.code')}</dt>
                            <dd className="break-all font-mono text-mist-300">{details.code}</dd>
                        </div>
                        {details.reference ? (
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <dt className="text-mist-400">{t('system.error.reference')}</dt>
                                <dd className="break-all font-mono text-mist-300">
                                    {details.reference}
                                </dd>
                            </div>
                        ) : null}
                    </dl>
                </div>
            }
        >
            <button
                type="button"
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-navy-950 transition-colors hover:bg-brand-400 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
                onClick={retry}
            >
                {t('common.retry')}
            </button>
            <Link
                to="/"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-bold text-white transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-400 motion-reduce:transition-none"
            >
                {t('common.backHome')}
            </Link>
        </SystemStatePage>
    )
}
