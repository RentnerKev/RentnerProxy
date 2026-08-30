import { CircleAlert, CircleCheck, Copy, Check, Info, TriangleAlert, X } from 'lucide-react'
import * as ToastPrimitive from 'radix-ui/toast'

import useTranslationStore from '../../../language/useTranslationStore'
import { Tooltip } from '../../Tooltip'
import useToastCardLogic from '../Hooks/useToastCardLogic'
import { toastClassNames } from '../Styles/toastClassNames'
import type { ToastMessage } from '../Types/toast.types'

export default function ToastCard({ toast }: { readonly toast: ToastMessage }) {
    const { t } = useTranslationStore()
    const { state, handler } = useToastCardLogic(toast)
    const tone = toastClassNames.tones[toast.tone]

    return (
        <ToastPrimitive.Root
            open={toast.open}
            duration={toast.duration}
            type={toast.tone === 'error' ? 'foreground' : 'background'}
            onOpenChange={handler.handleOpenChange}
            onPause={handler.pause}
            onResume={handler.resume}
            data-toast-tone={toast.tone}
            className={`${toastClassNames.card} ${tone.border}`}
        >
            <span
                className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${tone.icon}`}
                aria-hidden="true"
            >
                {toast.tone === 'success' ? <CircleCheck className="size-[1.1rem]" /> : null}
                {toast.tone === 'error' ? <CircleAlert className="size-[1.1rem]" /> : null}
                {toast.tone === 'info' ? <Info className="size-[1.1rem]" /> : null}
                {toast.tone === 'warning' ? <TriangleAlert className="size-[1.1rem]" /> : null}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
                <ToastPrimitive.Title className="text-sm font-extrabold tracking-tight text-ink">
                    {state.title}
                </ToastPrimitive.Title>
                <ToastPrimitive.Description className="mt-1 select-text text-[0.82rem] leading-relaxed whitespace-pre-wrap wrap-anywhere text-muted">
                    {state.message}
                </ToastPrimitive.Description>
                {state.copyStatus === 'failed' ? (
                    <output className="mt-1 block text-xs text-danger-text">
                        {state.copyLabel}
                    </output>
                ) : null}
            </div>
            <div
                className="-mt-1 -mr-1 flex shrink-0 items-center"
                data-radix-toast-announce-exclude=""
            >
                {toast.tone === 'error' ? (
                    <Tooltip content={state.copyLabel}>
                        <button
                            type="button"
                            className={toastClassNames.button}
                            aria-label={state.copyLabel}
                            onClick={handler.copy}
                        >
                            {state.copyStatus === 'copied' ? (
                                <Check aria-hidden="true" className="size-4 text-success-text" />
                            ) : (
                                <Copy aria-hidden="true" className="size-4" />
                            )}
                        </button>
                    </Tooltip>
                ) : null}
                <Tooltip content={t('toast.dismiss')}>
                    <ToastPrimitive.Close asChild>
                        <button
                            type="button"
                            className={toastClassNames.button}
                            aria-label={t('toast.dismiss')}
                        >
                            <X aria-hidden="true" className="size-4" />
                        </button>
                    </ToastPrimitive.Close>
                </Tooltip>
            </div>
            <div
                aria-hidden="true"
                className={`absolute bottom-0 left-0 h-0.5 w-full origin-left animate-toast-progress motion-reduce:hidden ${tone.progress}`}
                style={{
                    animationDuration: `${toast.duration}ms`,
                    animationPlayState: state.paused ? 'paused' : 'running',
                }}
            />
        </ToastPrimitive.Root>
    )
}
