import * as DropdownMenu from 'radix-ui/dropdown-menu'

import type { ActionMenuItemViewProps } from '../Types/action-menu.types'

export default function ActionMenuItemView({ item }: ActionMenuItemViewProps) {
    return (
        <DropdownMenu.Item
            {...(item.disabled ? { disabled: true } : {})}
            onSelect={item.onSelect}
            className={`group flex cursor-pointer select-none flex-col rounded-lg px-3 py-2 text-sm outline-hidden transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-hover data-[highlighted]:text-ink ${item.destructive ? 'text-danger-text data-[highlighted]:bg-danger-bg' : 'text-ink-soft'}`}
        >
            <span className="font-bold leading-snug">{item.label}</span>
            {item.description ? (
                <span className="mt-0.5 text-xs font-normal leading-snug text-muted group-data-[highlighted]:text-muted">
                    {item.description}
                </span>
            ) : null}
        </DropdownMenu.Item>
    )
}
