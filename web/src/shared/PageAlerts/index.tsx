import * as Popover from '@radix-ui/react-popover'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import { TriangleAlert, X } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import usePageAlertsLogic from './Hooks/usePageAlertsLogic.ts'

export default function PageAlerts() {
    const { t } = useTranslationStore()
    const { state, handler } = usePageAlertsLogic()
    if (state.alerts.length === 0) return null

    return (
        <Popover.Root open={state.open} onOpenChange={handler.handleOpenChange}>
            <output className="sr-only">
                {t(`pageAlerts.${state.severity}`, { count: state.alerts.length })}
            </output>
            <CustomTooltip
                disabled={state.open}
                side="bottom"
                align="end"
                collisionPadding={12}
                customDesign={{
                    baseClasses:
                        'max-h-[min(24rem,var(--radix-tooltip-content-available-height))] max-w-88 overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface-raised p-4 text-left text-xs text-ink shadow-surface',
                }}
                content={
                    <div className="grid gap-3">
                        {state.alerts.map((alert) => (
                            <div key={alert.id}>
                                <p className="m-0 font-extrabold">{alert.title}</p>
                                <p className="mt-1 mb-0 leading-relaxed text-muted">
                                    {alert.description}
                                </p>
                            </div>
                        ))}
                        <p className="m-0 font-semibold text-muted">
                            {t('pageAlerts.openDetails')}
                        </p>
                    </div>
                }
            >
                <Popover.Trigger asChild>
                    <button
                        type="button"
                        aria-label={t(`pageAlerts.${state.severity}`, {
                            count: state.alerts.length,
                        })}
                        className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring motion-reduce:transition-none ${state.severity === 'error' ? 'text-danger-text' : 'text-warning-text'}`}
                        data-severity={state.severity}
                    >
                        <TriangleAlert aria-hidden="true" className="size-5" strokeWidth={2} />
                    </button>
                </Popover.Trigger>
            </CustomTooltip>
            <Popover.Portal>
                <Popover.Content
                    align="end"
                    side="bottom"
                    sideOffset={10}
                    collisionPadding={12}
                    aria-label={t('pageAlerts.title')}
                    className="z-50 box-border max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface-raised p-4 text-ink shadow-surface outline-hidden"
                >
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <h2 className="m-0 text-sm font-extrabold">{t('pageAlerts.title')}</h2>
                        <Popover.Close
                            aria-label={t('common.closeDialog')}
                            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent-ring"
                        >
                            <X aria-hidden="true" className="size-4" />
                        </Popover.Close>
                    </div>
                    <ul className="m-0 grid list-none gap-4 p-0">
                        {state.alerts.map((alert) => (
                            <li key={alert.id} className="grid gap-2 border-t border-border pt-3">
                                <div className="flex items-start gap-2">
                                    <TriangleAlert
                                        aria-hidden="true"
                                        className={`mt-0.5 size-4 shrink-0 ${alert.severity === 'error' ? 'text-danger-text' : 'text-warning-text'}`}
                                    />
                                    <div className="min-w-0">
                                        <p className="m-0 text-sm font-extrabold">{alert.title}</p>
                                        <p className="mt-1 mb-0 text-sm leading-relaxed wrap-anywhere text-muted">
                                            {alert.description}
                                        </p>
                                    </div>
                                </div>
                                {alert.action ? (
                                    <div className="flex flex-wrap gap-2 pl-6">{alert.action}</div>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
