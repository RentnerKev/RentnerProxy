import type { HostTag } from '@/lib/HostTags/Types/host-tags.types.ts'
import { hostTagBadgeStyle } from '@/lib/HostTags/hostTagColor.ts'

export default function HostTagBadge({ tag }: { readonly tag: HostTag }) {
    return (
        <span
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle text-xs font-semibold leading-5 text-ink-soft"
            title={tag.name}
        >
            <span
                className="size-2 shrink-0 rounded-full"
                style={hostTagBadgeStyle(tag.color)}
                aria-hidden="true"
            />
            <span className="min-w-0 max-w-48 truncate">{tag.name}</span>
        </span>
    )
}
