import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { ArrowUp, CircleAlert } from 'lucide-react'

import { APP_VERSION } from '@/lib/ApplicationVersion/version.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { ApplicationVersionProps } from '@/features/ApplicationVersion/Types/application-version-logic.types.ts'

const versionWithoutPrefix = APP_VERSION.replace(/^v/, '')
const displayVersion =
    versionWithoutPrefix.startsWith('dev-') || versionWithoutPrefix.includes('-dev')
        ? versionWithoutPrefix
        : `v${versionWithoutPrefix}`

export default function ApplicationVersion({ data, onOpen }: ApplicationVersionProps) {
    const { t } = useTranslationStore()
    const updateLabel =
        data?.status === 'unavailable'
            ? t('updates.checkFailedIndicator')
            : t('shell.updateAvailable', { version: data?.latest?.version })

    return (
        <div className="flex min-h-4 shrink-0 items-center justify-start gap-1.5 text-[0.65rem] leading-4 text-mist-400 shell:-mt-5 shell:-ml-4">
            <span
                aria-label={t('shell.systemVersion', { version: displayVersion })}
                className="font-mono tabular-nums"
            >
                {displayVersion}
            </span>
            {data?.status === 'unavailable' || (data?.status === 'available' && data.latest) ? (
                <CustomTooltip collisionPadding={10} content={updateLabel}>
                    <button
                        type="button"
                        onClick={onOpen}
                        aria-haspopup="dialog"
                        aria-label={updateLabel}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-amber-400 hover:bg-amber-400/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
                    >
                        {data.status === 'unavailable' ? (
                            <CircleAlert className="size-4" aria-hidden="true" />
                        ) : (
                            <span className="application-update-signal inline-flex rounded-full p-1">
                                <ArrowUp className="size-4" aria-hidden="true" />
                            </span>
                        )}
                    </button>
                </CustomTooltip>
            ) : null}
        </div>
    )
}
