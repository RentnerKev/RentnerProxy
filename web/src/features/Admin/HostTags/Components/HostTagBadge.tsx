import type { HostTag } from '@/lib/HostTags/Types/host-tags.types.ts'
import { hostTagBadgeStyle } from '@/lib/HostTags/hostTagColor.ts'

export default function HostTagBadge({ tag }: { readonly tag: HostTag }) {
    return (
        <span
            className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-tight ring-1 ring-inset ring-black/10"
            style={hostTagBadgeStyle(tag.color)}
        >
            <span className="min-w-0 break-words">{tag.name}</span>
        </span>
    )
}
