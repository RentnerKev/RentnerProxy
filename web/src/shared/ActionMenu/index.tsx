import { Menu } from '@rentnerkev/menu'
import { EllipsisVertical } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import useActionMenuLogic from './Hooks/useActionMenuLogic.ts'
import type { ActionMenuProps } from './Types/action-menu.types.ts'

export function ActionMenu({ items, ariaLabel, openOnHover = true }: ActionMenuProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useActionMenuLogic(items)

    return (
        <Menu
            asChild
            ariaLabel={ariaLabel ?? t('common.openActions')}
            items={state.items}
            open={state.open}
            onOpenChange={handler.handleOpenChange}
            onAction={handler.handleAction}
            openOnHover={openOnHover}
            align="end"
            sideOffset={6}
            collisionPadding={8}
            portalZIndex={90}
            classNames={{
                content:
                    'rounded-xl shadow-panel [--rentner-foreground:var(--theme-ink-soft)] [--rentner-surface:var(--theme-surface-raised)] [--rentner-control:var(--theme-surface-hover)] [--rentner-border:var(--theme-border)] [--rentner-muted:var(--theme-muted)] [--rentner-danger:var(--theme-danger-text)]',
                item: 'min-h-12 rounded-lg px-3 transition-colors hover:bg-surface-hover aria-disabled:pointer-events-none aria-disabled:opacity-45 data-[danger=true]:focus:bg-danger-bg data-[danger=true]:hover:bg-danger-bg motion-reduce:transition-none',
                label: 'font-bold leading-snug',
                description: 'font-normal leading-snug',
                indicator: 'hidden',
            }}
            trigger={
                <button
                    type="button"
                    className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-transparent text-xl font-extrabold leading-none text-muted transition-[background-color,border-color,color] duration-150 hover:border-border-strong hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring motion-reduce:transition-none"
                >
                    <EllipsisVertical aria-hidden="true" className="size-5" strokeWidth={2} />
                </button>
            }
        />
    )
}
