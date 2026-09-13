import { hasFlag } from 'country-flag-icons'

import type { SelectControlOption } from '../Types/select-control.types'

export default function SelectOptionLabel({ option }: { readonly option: SelectControlOption }) {
    const hasCountryFlag = option.countryCode ? hasFlag(option.countryCode) : false

    return (
        <span className="inline-flex min-w-0 max-w-full items-center gap-2">
            {hasCountryFlag ? (
                <span
                    aria-hidden="true"
                    className={`flag:${option.countryCode} h-4 w-6 shrink-0 rounded-sm ring-1 ring-black/10 [--CountryFlagIcon-height:1rem]`}
                />
            ) : null}
            <span className="truncate">{option.label}</span>
        </span>
    )
}
