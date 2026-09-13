import { ArrowUp } from 'lucide-react'

import { APP_VERSION } from '../../../../config/version.config'
import useTranslationStore from '../../../../language/useTranslationStore'
import { Tooltip } from '../../../../shared/Tooltip'
import useApplicationVersionLogic from '../../../../features/ApplicationVersion/Hooks/useApplicationVersionLogic'

export default function ApplicationVersion() {
    const { t } = useTranslationStore()
    const { data } = useApplicationVersionLogic()
    const updateLabel = t('shell.updateAvailable', { version: data?.latestVersion })

    return (
        <div className="-mt-3 flex min-h-6 shrink-0 items-center justify-center gap-2 text-xs text-mist-400">
            <span
                aria-label={t('shell.systemVersion', { version: APP_VERSION })}
                className="font-mono tabular-nums"
            >
                {APP_VERSION.startsWith('v') ? APP_VERSION : `v${APP_VERSION}`}
            </span>
            {data?.latestVersion ? (
                <Tooltip content={updateLabel}>
                    <a
                        href="https://github.com/RentnerKev/RentnerProxy/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={updateLabel}
                        className="inline-flex size-6 items-center justify-center rounded text-brand-500 hover:bg-brand-500/15 focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                        <ArrowUp className="size-4" aria-hidden="true" />
                    </a>
                </Tooltip>
            ) : null}
        </div>
    )
}
