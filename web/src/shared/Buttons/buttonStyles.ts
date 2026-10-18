const baseClasses =
    'box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none'

const primaryClasses = 'bg-accent text-accent-foreground enabled:hover:bg-accent-hover'

const secondaryClasses =
    'border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring'

export function buttonClassName(variant: 'primary' | 'secondary', extraClasses = '') {
    const variantClasses = variant === 'primary' ? primaryClasses : secondaryClasses
    return baseClasses + ' ' + variantClasses + (extraClasses ? ' ' + extraClasses : '')
}
