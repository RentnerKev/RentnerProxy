import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { SearchableSelectOption } from '../SearchableSelect'

export default function useSearchableSelect({
    onChange,
    options,
    disabled,
}: {
    onChange: (value: string) => void
    options: readonly SearchableSelectOption[]
    disabled: boolean
}) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const rootRef = useRef(null as HTMLDivElement | null)
    const searchRef = useRef(null as HTMLInputElement | null)
    const triggerRef = useRef(null as HTMLButtonElement | null)
    const optionRefs = useRef([] as Array<HTMLButtonElement | null>)
    const listboxId = useId()
    const filteredOptions = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase()
        if (!normalizedSearch) return options
        return options.filter(
            (option) =>
                option.label.toLocaleLowerCase().includes(normalizedSearch) ||
                option.value.toLocaleLowerCase().includes(normalizedSearch),
        )
    }, [options, search])
    const optionCount = filteredOptions.length + 1

    const close = useCallback((restoreFocus: boolean) => {
        setOpen(false)
        setSearch('')
        setActiveIndex(0)
        if (restoreFocus) triggerRef.current?.focus()
    }, [])
    const openPopup = useCallback(() => {
        setSearch('')
        setActiveIndex(0)
        setOpen(true)
    }, [])
    const toggle = useCallback(() => {
        if (disabled) return
        if (open) close(false)
        else openPopup()
    }, [close, disabled, open, openPopup])
    const focusOption = useCallback(
        (index: number) => {
            const boundedIndex = Math.min(Math.max(index, 0), optionCount - 1)
            setActiveIndex(boundedIndex)
            optionRefs.current[boundedIndex]?.focus()
        },
        [optionCount],
    )
    const selectOption = useCallback(
        (index: number) => {
            const nextValue = index === 0 ? '' : filteredOptions[index - 1]?.value
            if (nextValue === undefined) return
            onChange(nextValue)
            close(true)
        },
        [close, filteredOptions, onChange],
    )
    const handleTriggerKeyDown = useCallback(
        (event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!open) openPopup()
            } else if (event.key === 'Escape' && open) {
                event.preventDefault()
                close(true)
            }
        },
        [close, open, openPopup],
    )
    const handleSearchKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                focusOption(activeIndex)
            } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                focusOption(optionCount - 1)
            } else if (event.key === 'Enter') {
                event.preventDefault()
                if (search.trim()) {
                    if (filteredOptions.length > 0) selectOption(1)
                } else selectOption(activeIndex)
            } else if (event.key === 'Escape') {
                event.preventDefault()
                close(true)
            }
        },
        [activeIndex, close, filteredOptions, focusOption, optionCount, search, selectOption],
    )
    const handleOptionKeyDown = useCallback(
        (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                focusOption(index + 1)
            } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                focusOption(index - 1)
            } else if (event.key === 'Enter') {
                event.preventDefault()
                selectOption(index)
            } else if (event.key === 'Escape') {
                event.preventDefault()
                close(true)
            }
        },
        [close, focusOption, selectOption],
    )

    useEffect(() => {
        if (!open) return
        searchRef.current?.focus()
    }, [open])
    useEffect(() => {
        if (!open) return
        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) close(false)
        }
        const handleFocusIn = (event: FocusEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) close(false)
        }
        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('focusin', handleFocusIn)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('focusin', handleFocusIn)
        }
    }, [close, open])

    const setOptionRef = useCallback((index: number, element: HTMLButtonElement | null) => {
        optionRefs.current[index] = element
    }, [])
    return {
        open,
        search,
        activeIndex,
        rootRef,
        searchRef,
        triggerRef,
        setOptionRef,
        listboxId,
        filteredOptions,
        setSearch,
        setActiveIndex,
        toggle,
        handleTriggerKeyDown,
        handleSearchKeyDown,
        handleOptionKeyDown,
        selectOption,
    }
}
