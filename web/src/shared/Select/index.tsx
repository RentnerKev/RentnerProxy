import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import * as Select from 'radix-ui/select'

import { EMPTY_SELECT_VALUE, fromSelectValue, toSelectValue } from './Helpers/selectValue'
import type { SelectControlProps } from './Types/select-control.types'

const itemClassName =
    'group relative flex min-h-9 cursor-pointer select-none items-center rounded-lg py-2 pr-8 pl-3 text-xs font-bold text-ink-soft outline-hidden transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-hover data-[highlighted]:text-ink data-[state=checked]:bg-success-bg data-[state=checked]:text-success-text motion-reduce:transition-none'

export default function SelectControl({
    ariaLabel,
    className,
    onValueChange,
    options,
    placeholder,
    value,
}: SelectControlProps) {
    return (
        <Select.Root
            value={toSelectValue(value)}
            onValueChange={(nextValue) => onValueChange(fromSelectValue(nextValue))}
        >
            <Select.Trigger
                aria-label={ariaLabel}
                className={`group inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-lg border border-input-border bg-surface-raised px-2.5 text-left text-xs font-bold text-ink outline-hidden transition-[border-color,box-shadow,background-color] data-[placeholder]:text-muted-soft hover:border-border-strong focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/15 motion-reduce:transition-none ${className ?? ''}`}
            >
                <Select.Value />
                <Select.Icon className="shrink-0 text-muted transition-colors group-data-[state=open]:text-brand-text">
                    <ChevronDown
                        aria-hidden="true"
                        className="size-4 transition-transform duration-150 motion-reduce:transition-none"
                        strokeWidth={1.8}
                    />
                </Select.Icon>
            </Select.Trigger>

            <Select.Portal>
                <Select.Content
                    position="popper"
                    sideOffset={6}
                    collisionPadding={8}
                    className="relative z-[70] max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-surface-raised text-ink shadow-panel outline-hidden before:pointer-events-none before:absolute before:inset-x-3 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-500/70 before:to-transparent data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none"
                >
                    <Select.ScrollUpButton className="flex h-7 cursor-pointer items-center justify-center border-b border-border bg-surface-subtle text-muted">
                        <ChevronUp aria-hidden="true" className="size-4" strokeWidth={1.8} />
                    </Select.ScrollUpButton>
                    <Select.Viewport className="p-1.5">
                        {placeholder ? (
                            <Select.Item value={EMPTY_SELECT_VALUE} className={itemClassName}>
                                <Select.ItemText>{placeholder}</Select.ItemText>
                                <Select.ItemIndicator className="absolute right-3 grid size-4 place-items-center">
                                    <Check
                                        aria-hidden="true"
                                        className="size-3.5 text-brand-text"
                                        strokeWidth={2.25}
                                    />
                                </Select.ItemIndicator>
                            </Select.Item>
                        ) : null}
                        {options.map((option) => (
                            <Select.Item
                                key={option.value}
                                value={option.value}
                                className={itemClassName}
                            >
                                <Select.ItemText>{option.label}</Select.ItemText>
                                <Select.ItemIndicator className="absolute right-3 grid size-4 place-items-center">
                                    <Check
                                        aria-hidden="true"
                                        className="size-3.5 text-brand-text"
                                        strokeWidth={2.25}
                                    />
                                </Select.ItemIndicator>
                            </Select.Item>
                        ))}
                    </Select.Viewport>
                    <Select.ScrollDownButton className="flex h-7 cursor-pointer items-center justify-center border-t border-border bg-surface-subtle text-muted">
                        <ChevronDown aria-hidden="true" className="size-4" strokeWidth={1.8} />
                    </Select.ScrollDownButton>
                </Select.Content>
            </Select.Portal>
        </Select.Root>
    )
}

export type { SelectControlOption, SelectControlProps } from './Types/select-control.types'
