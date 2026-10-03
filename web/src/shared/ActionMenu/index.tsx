import { EllipsisVertical } from 'lucide-react'
import * as DropdownMenu from 'radix-ui/dropdown-menu'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

import ActionMenuItemView from './Components/ActionMenuItemView.tsx'
import useActionMenuLogic from './Hooks/useActionMenuLogic.ts'
import type { ActionMenuProps } from './Types/action-menu.types.ts'

export function ActionMenu({ items, ariaLabel, openOnHover = true }: ActionMenuProps) {
    const { t } = useTranslationStore()
    const {
        state,
        handler,
        refs: { trigger: triggerRef, content: contentRef },
    } = useActionMenuLogic(openOnHover)

    return (
        <DropdownMenu.Root
            {...(state.openOnHover
                ? { open: state.open, onOpenChange: handler.handleOpenChange, modal: false }
                : {})}
        >
            <DropdownMenu.Trigger asChild>
                <button
                    ref={triggerRef}
                    {...(state.openOnHover
                        ? {
                              onPointerEnter: handler.handlePointerEnter,
                              onPointerLeave: handler.handlePointerLeave,
                              onKeyDownCapture: handler.handleKeyDown,
                          }
                        : {})}
                    type="button"
                    aria-label={ariaLabel ?? t('common.openActions')}
                    className="inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-transparent text-xl font-extrabold leading-none text-muted transition-[background-color,border-color,color] duration-150 hover:border-border-strong hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring motion-reduce:transition-none"
                >
                    <EllipsisVertical aria-hidden="true" className="size-5" strokeWidth={2} />
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content
                    ref={contentRef}
                    {...(state.openOnHover
                        ? {
                              onPointerEnter: handler.handlePointerEnter,
                              onPointerLeave: handler.handlePointerLeave,
                              onKeyDownCapture: handler.handleKeyDown,
                              onOpenAutoFocus: handler.handleOpenAutoFocus,
                              onCloseAutoFocus: handler.handleCloseAutoFocus,
                          }
                        : {})}
                    align="end"
                    sideOffset={6}
                    collisionPadding={8}
                    className="z-50 min-w-48 rounded-xl border border-border bg-surface-raised p-1.5 shadow-panel outline-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none"
                >
                    {items.map((item) => (
                        <ActionMenuItemView key={item.label} item={item} />
                    ))}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    )
}
