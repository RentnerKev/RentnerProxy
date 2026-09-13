import { ChevronDown } from 'lucide-react'

import useProxyAccessLogsHostFilter from '../Hooks/useProxyAccessLogsHostFilter'

interface ProxyAccessLogsHostFilterProps {
    readonly allHostsLabel: string
    readonly ariaDescribedBy?: string | undefined
    readonly invalid: boolean
    readonly label: string
    readonly noResultsLabel: string
    readonly onChange: (value: string) => void
    readonly options: readonly string[]
    readonly placeholder: string
    readonly searchPlaceholder: string
    readonly value: string
}

const controlClassName =
    'box-border inline-flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input-border bg-surface-raised px-3 text-left text-sm text-ink outline-hidden transition-[border-color,box-shadow,background-color] hover:border-border-strong focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20 aria-invalid:border-red-500'
const optionClassName =
    'flex min-h-10 w-full cursor-pointer items-center rounded-lg px-3 py-2 text-left text-sm font-bold text-ink-soft transition-colors hover:bg-surface-hover focus:bg-surface-hover focus:outline-hidden'

export default function ProxyAccessLogsHostFilter({
    allHostsLabel,
    ariaDescribedBy,
    invalid,
    label,
    noResultsLabel,
    onChange,
    options,
    placeholder,
    searchPlaceholder,
    value,
}: ProxyAccessLogsHostFilterProps) {
    const {
        activeIndex,
        filteredOptions,
        handleOptionKeyDown,
        handleSearchChange,
        handleSearchKeyDown,
        handleTriggerKeyDown,
        listboxId,
        open,
        search,
        setOptionRef,
        setRootRef,
        setSearchRef,
        setTriggerRef,
        selectOption,
        toggle,
    } = useProxyAccessLogsHostFilter({ onChange, options })

    return (
        <div ref={setRootRef} className="relative min-w-0">
            <button
                type="button"
                ref={setTriggerRef}
                id="proxy-log-host-filter"
                aria-label={label}
                aria-controls={open ? listboxId : undefined}
                aria-describedby={ariaDescribedBy}
                aria-expanded={open}
                aria-haspopup="listbox"
                className={`${controlClassName} ${invalid ? 'border-red-500' : ''}`}
                onClick={toggle}
                onKeyDown={handleTriggerKeyDown}
            >
                <span className={value ? 'truncate text-ink' : 'truncate text-muted-soft'}>
                    {value || placeholder}
                </span>
                <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
                    strokeWidth={1.8}
                />
            </button>
            {open ? (
                <div className="absolute top-[calc(100%+0.4rem)] left-0 z-[70] max-h-[min(20rem,calc(100vh-1rem))] w-full min-w-64 overflow-y-auto rounded-xl border border-border bg-surface-raised p-1.5 text-ink shadow-panel outline-hidden">
                    <div className="sticky top-0 z-10 bg-surface-raised p-1.5">
                        <input
                            ref={setSearchRef}
                            type="search"
                            aria-label={searchPlaceholder}
                            aria-controls={listboxId}
                            aria-autocomplete="list"
                            value={search}
                            placeholder={searchPlaceholder}
                            onChange={(event) => handleSearchChange(event.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            className="box-border h-10 w-full rounded-lg border border-input-border bg-surface px-3 text-sm text-ink outline-hidden placeholder:text-muted-soft focus:border-brand-600 focus:ring-[3px] focus:ring-brand-500/20"
                        />
                    </div>
                    <div
                        id={listboxId}
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The searchable popup needs a listbox container while retaining a text input.
                        role="listbox"
                        aria-label={label}
                    >
                        <button
                            type="button"
                            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Buttons provide the required keyboard interaction for options.
                            role="option"
                            aria-selected={value.length === 0}
                            tabIndex={activeIndex === 0 ? 0 : -1}
                            ref={(element) => {
                                setOptionRef(0, element)
                            }}
                            onClick={() => selectOption(0)}
                            onKeyDown={(event) => handleOptionKeyDown(0, event)}
                            className={`${optionClassName} ${activeIndex === 0 ? 'bg-surface-hover' : ''}`}
                        >
                            {allHostsLabel}
                        </button>
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, optionIndex) => {
                                const index = optionIndex + 1
                                return (
                                    <button
                                        key={option}
                                        type="button"
                                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Buttons provide the required keyboard interaction for options.
                                        role="option"
                                        aria-selected={value === option}
                                        tabIndex={activeIndex === index ? 0 : -1}
                                        ref={(element) => {
                                            setOptionRef(index, element)
                                        }}
                                        onClick={() => selectOption(index)}
                                        onKeyDown={(event) => handleOptionKeyDown(index, event)}
                                        className={`${optionClassName} ${activeIndex === index ? 'bg-surface-hover' : ''}`}
                                    >
                                        {option}
                                    </button>
                                )
                            })
                        ) : (
                            <div
                                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Keep the empty state in the same listbox semantics.
                                role="option"
                                aria-selected={false}
                                aria-disabled="true"
                                className="px-3 py-2 text-sm text-muted"
                            >
                                {noResultsLabel}
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    )
}
