import type { SelectControlOption } from '../Types/select-control.types'

export default function SelectOptionLabel({ option }: { readonly option: SelectControlOption }) {
    return (
        <span className="inline-flex items-center gap-2">
            {option.imageSrc ? (
                <img
                    alt=""
                    aria-hidden="true"
                    className="h-4 w-6 shrink-0 rounded-sm object-cover ring-1 ring-black/10"
                    height={16}
                    src={option.imageSrc}
                    width={24}
                />
            ) : null}
            {option.label}
        </span>
    )
}
