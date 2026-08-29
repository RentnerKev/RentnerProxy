const interactiveButtonClassName =
    'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-[0.65rem] font-extrabold transition-[transform,background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none'

const primaryButtonClassName = `${interactiveButtonClassName} bg-brand-500 text-navy-950 shadow-[0_10px_24px_rgb(15_179_58_/_20%)] enabled:hover:-translate-y-px enabled:hover:bg-brand-300`

const formControlClassName =
    'box-border min-h-[2.85rem] w-full rounded-xl border border-input-border bg-surface-raised px-[0.85rem] py-[0.72rem] text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted-soft focus:border-brand-600 focus:outline-hidden focus:ring-[3px] focus:ring-brand-500/20 motion-reduce:transition-none'

const managementCardClassName =
    'min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface'

export const uiClassNames = {
    technicalLabel:
        'm-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-brand-400 uppercase',
    themedTechnicalLabel:
        'm-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-brand-text uppercase',
    button: {
        add: `${primaryButtonClassName} h-10 min-w-[8.5rem] py-0 text-sm whitespace-nowrap`,
        primary: `${primaryButtonClassName} min-h-[2.7rem]`,
        secondary: `${interactiveButtonClassName} min-h-[2.7rem] border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text`,
        danger: `${interactiveButtonClassName} min-h-[2.7rem] border-red-700/25 bg-danger-bg text-danger-text enabled:hover:-translate-y-px enabled:hover:border-red-500/45 enabled:hover:bg-red-700/20`,
        quiet: `${interactiveButtonClassName} min-h-9 bg-transparent text-muted enabled:hover:border-brand-600 enabled:hover:text-brand-text`,
    },
    form: {
        stack: 'mt-7 grid gap-[1.1rem]',
        grid: 'shell:grid-cols-2 shell:items-start',
        field: 'grid gap-[0.45rem]',
        label: 'text-[0.82rem] font-[750] text-ink-soft',
        labelRow:
            'flex items-center justify-between gap-4 text-[0.82rem] font-[750] text-ink-soft [&_a]:text-[0.76rem]',
        control: formControlClassName,
        textarea: `${formControlClassName} min-h-26 resize-y`,
        hint: 'm-0 text-[0.76rem] leading-[1.45] text-muted',
        wide: 'shell:col-span-full',
    },
    management: {
        card: managementCardClassName,
        editorCard: `${managementCardClassName} mb-4`,
        editorHeader:
            'flex flex-wrap items-center justify-between gap-4 [&_h2]:mt-[0.45rem] [&_h2]:text-xl [&_h2]:text-ink-soft',
        grid: 'grid gap-4',
        accountGrid:
            'grid gap-4 shell:grid-cols-[minmax(16rem,0.7fr)_minmax(24rem,1.3fr)] shell:items-start',
    },
    permission: {
        fieldset:
            'm-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft',
        options: 'grid gap-[0.45rem]',
        matrix: 'shell:grid-cols-2',
        option: 'flex cursor-pointer items-start gap-[0.65rem] rounded-[0.7rem] border border-border bg-surface-raised p-[0.65rem]',
        checkbox: 'mt-[0.12rem] size-4 accent-brand-600',
        copy: 'grid gap-[0.12rem]',
        title: 'text-[0.78rem] text-ink-soft',
        description: 'font-mono text-[0.62rem] text-muted',
    },
    table: {
        panel: 'overflow-hidden rounded-2xl border border-border bg-surface shadow-surface',
        toolbar:
            'flex flex-wrap items-center justify-between gap-4 border-b border-border px-[1.15rem] py-4 [&_h2]:mt-[0.45rem] [&_h2]:text-xl [&_h2]:text-ink-soft',
        searchLabel: 'grid w-[min(100%,22rem)] gap-[0.35rem] text-[0.68rem] font-[750] text-muted',
        search: formControlClassName,
        code: 'rounded-[0.3rem] bg-code px-[0.35rem] py-[0.18rem] text-[0.7rem] text-ink-soft',
        actions: 'flex gap-[0.35rem]',
        compactAction: 'min-h-8! px-[0.55rem] py-[0.35rem] text-[0.7rem]',
        empty: 'p-8 text-center text-muted',
    },
    chip: {
        row: 'flex flex-wrap gap-[0.45rem]',
        item: 'inline-flex items-center rounded-full border border-brand-600/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text',
    },
} as const
