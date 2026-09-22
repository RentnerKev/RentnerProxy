import type { ToastCustomDesign, ToastPosition, ToastProviderProps } from '@rentnerkev/toasts/types'

export const TOAST_POSITION: ToastPosition = 'bottom-right'
export const TOAST_ROOT_CLASS = 'rentnerproxy-toast'

export const TOAST_CLASS_NAME = `${TOAST_ROOT_CLASS} w-[min(25rem,calc(100vw-2rem))] rounded-2xl border-border bg-surface-raised px-4 py-4 text-ink shadow-panel backdrop-blur-none`

export const TOAST_CUSTOM_DESIGN = {
    successWrapper:
        'rentnerproxy-toast-success border-border border-l-[3px] border-l-success-text bg-surface-raised text-ink',
    errorWrapper:
        'rentnerproxy-toast-error border-border border-l-[3px] border-l-danger-text bg-surface-raised text-ink',
    infoWrapper:
        'rentnerproxy-toast-info border-border border-l-[3px] border-l-info-text bg-surface-raised text-ink',
    warningWrapper:
        'rentnerproxy-toast-warning border-border border-l-[3px] border-l-warning-text bg-surface-raised text-ink',
    successIcon: 'text-success-text',
    errorIcon: 'text-danger-text',
    infoIcon: 'text-info-text',
    warningIcon: 'text-warning-text',
    successProgress: 'bg-success-text',
    errorProgress: 'bg-danger-text',
    infoProgress: 'bg-info-text',
    warningProgress: 'bg-warning-text',
    titleText: 'text-ink',
    contentText: 'text-muted',
    linkText:
        'pointer-events-auto inline-block cursor-pointer font-extrabold text-brand-text underline decoration-2 underline-offset-2 transition-opacity hover:opacity-80 motion-reduce:transition-none',
    closeButton: 'text-muted group-hover:text-ink',
    copyButton: 'text-muted group-hover:text-ink',
} satisfies ToastCustomDesign

export const TOAST_PROVIDER_PROPS = {
    position: TOAST_POSITION,
    className: TOAST_CLASS_NAME,
    customDesign: TOAST_CUSTOM_DESIGN,
} satisfies Pick<ToastProviderProps, 'position' | 'className' | 'customDesign'>
