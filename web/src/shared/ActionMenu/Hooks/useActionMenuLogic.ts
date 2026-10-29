import { useMemo, useState } from 'react'
import { flushSync } from 'react-dom'

import type { ActionMenuItem, ActionMenuLogicResult } from '../Types/action-menu.types.ts'

export default function useActionMenuLogic(
    items: readonly ActionMenuItem[],
): ActionMenuLogicResult {
    const [open, setOpen] = useState(false)
    const menuItems = useMemo(
        () =>
            items.map((item) => ({
                id: item.id,
                label: item.label,
                ...(item.description ? { description: item.description } : {}),
                ...(item.disabled ? { disabled: true } : {}),
                ...(item.destructive ? { danger: true } : {}),
            })),
        [items],
    )

    return {
        state: { open, items: menuItems },
        handler: {
            handleOpenChange: setOpen,
            handleAction: (id) => {
                const item = items.find((candidate) => candidate.id === id)
                if (!item || item.disabled) return

                // Restore the trigger before an action opens another focus scope.
                flushSync(() => setOpen(false))
                item.onSelect()
            },
        },
    }
}
