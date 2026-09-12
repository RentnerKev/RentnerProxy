import { useId, useState } from 'react'

export default function useTableFilters(
    expanded?: boolean,
    onExpandedChange?: (expanded: boolean) => void,
) {
    const contentId = useId()
    const [isOpen, setIsOpen] = useState(false)
    const open = expanded ?? isOpen

    return {
        contentId,
        open,
        toggle: () => {
            if (expanded === undefined) setIsOpen((value) => !value)
            onExpandedChange?.(!open)
        },
    }
}
