import { SearchableSelect } from '../../../../shared/Select'

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
    return (
        <SearchableSelect
            id="proxy-log-host-filter"
            allLabel={allHostsLabel}
            ariaLabel={label}
            ariaDescribedBy={ariaDescribedBy}
            invalid={invalid}
            noResultsLabel={noResultsLabel}
            onChange={onChange}
            options={options.map((option) => ({ label: option, value: option }))}
            placeholder={placeholder}
            searchPlaceholder={searchPlaceholder}
            value={value}
        />
    )
}
