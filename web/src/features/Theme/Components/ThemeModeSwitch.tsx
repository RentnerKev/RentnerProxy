import type { ThemeModeSwitchProps } from '../Types/theme-component-props.types'

export default function ThemeModeSwitch({
    errorMessage,
    isSaving,
    onToggle,
    themeMode,
}: ThemeModeSwitchProps) {
    const isDark = themeMode === 'dark'
    const targetLabel = isDark ? 'light' : 'dark'

    return (
        <div className="inline-flex flex-none items-center gap-[0.55rem]">
            <span
                className="min-w-[2.4rem] text-right text-[0.82rem] text-muted"
                aria-hidden="true"
            >
                {isDark ? 'Dark' : 'Light'}
            </span>
            <button
                type="button"
                role="switch"
                className="group relative grid h-[2.05rem] w-16 grid-cols-2 items-center rounded-full border border-border-strong bg-surface-raised p-[0.2rem] text-muted shadow-[inset_0_1px_2px_rgb(2_10_11_/_12%)] transition-[border-color,background-color] duration-[180ms] hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-500 disabled:cursor-wait disabled:opacity-[0.68] motion-reduce:transition-none"
                aria-busy={isSaving}
                aria-checked={isDark}
                aria-label={`Switch to ${targetLabel} mode`}
                disabled={isSaving}
                onClick={onToggle}
            >
                <span
                    className={`z-[2] grid place-items-center [&>svg]:size-[0.9rem] [&>svg]:stroke-[1.65] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] ${isDark ? 'text-muted' : 'text-navy-950'}`}
                    aria-hidden="true"
                >
                    <SunIcon />
                </span>
                <span
                    className={`z-[2] grid place-items-center [&>svg]:size-[0.9rem] [&>svg]:stroke-[1.65] [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] ${isDark ? 'text-navy-950' : 'text-muted'}`}
                    aria-hidden="true"
                >
                    <MoonIcon />
                </span>
                <span
                    className="absolute top-[0.21rem] left-[0.21rem] z-[1] size-[1.55rem] rounded-full bg-brand-500 shadow-[0_4px_12px_rgb(15_179_58_/_28%)] transition-transform duration-[180ms] group-aria-checked:translate-x-[1.93rem] motion-reduce:transition-none"
                    aria-hidden="true"
                />
            </button>
            {errorMessage ? (
                <span className="sr-only" role="alert">
                    {errorMessage}
                </span>
            ) : null}
        </div>
    )
}

function SunIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <circle cx="10" cy="10" r="3" />
            <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M16 4l-1.4 1.4M5.4 14.6 4 16" />
        </svg>
    )
}

function MoonIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M16.2 12.7A7 7 0 0 1 7.3 3.8 7 7 0 1 0 16.2 12.7Z" />
        </svg>
    )
}
