export const toastClassNames = {
    viewport:
        'pointer-events-none fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-[100] m-0 flex w-[min(25rem,calc(100vw-2rem))] max-w-full list-none flex-col gap-3 p-0 outline-none',
    card: 'group pointer-events-auto relative flex w-full touch-pan-y items-start gap-3 overflow-hidden rounded-2xl border border-l-[3px] border-border bg-surface-raised p-4 shadow-panel outline-none focus-visible:ring-2 focus-visible:ring-brand-500 data-[state=open]:animate-toast-enter data-[state=closed]:animate-toast-leave data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:animate-toast-swipe motion-reduce:animate-none',
    button: 'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transition-none',
    tones: {
        success: {
            border: 'border-l-success-text',
            icon: 'bg-success-bg text-success-text',
            progress: 'bg-success-text',
        },
        error: {
            border: 'border-l-danger-text',
            icon: 'bg-danger-bg text-danger-text',
            progress: 'bg-danger-text',
        },
        info: {
            border: 'border-l-info-text',
            icon: 'bg-info-bg text-info-text',
            progress: 'bg-info-text',
        },
        warning: {
            border: 'border-l-warning-text',
            icon: 'bg-neutral text-warning-text',
            progress: 'bg-warning-text',
        },
    },
} as const
