import * as Popover from 'radix-ui/popover'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'

import { uiClassNames } from '../Styles/uiClassNames'
import ManagedDomainLink from './ManagedDomainLink'

interface ManagedDomainOverflowProps {
    readonly ariaLabel: string
    readonly domains: ReadonlyArray<string>
}

function stopPropagation(event: KeyboardEvent | MouseEvent | PointerEvent): void {
    event.stopPropagation()
}

export default function ManagedDomainOverflow({ ariaLabel, domains }: ManagedDomainOverflowProps) {
    if (domains.length === 0) return null

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={ariaLabel}
                    className="inline-flex h-12 items-center justify-center rounded-xl border-0 bg-neutral px-3 py-0 font-mono text-sm font-bold text-muted outline-hidden hover:text-ink focus-visible:outline-2 focus-visible:outline-brand-500"
                    onClick={stopPropagation}
                    onKeyDown={stopPropagation}
                    onPointerDown={stopPropagation}
                >
                    +{domains.length}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="start"
                    side="top"
                    sideOffset={8}
                    collisionPadding={10}
                    aria-label={ariaLabel}
                    className="z-[90] max-w-72 rounded-xl border border-border bg-surface-raised p-3 shadow-surface outline-hidden"
                    onClick={stopPropagation}
                    onKeyDown={stopPropagation}
                    onPointerDown={stopPropagation}
                >
                    <div className={uiClassNames.chip.row}>
                        {domains.map((domain) => (
                            <ManagedDomainLink
                                className={uiClassNames.chip.item + ' max-w-64 wrap-anywhere'}
                                domain={domain}
                                key={domain}
                            />
                        ))}
                    </div>
                    <Popover.Arrow className="fill-surface-raised stroke-border" />
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    )
}
