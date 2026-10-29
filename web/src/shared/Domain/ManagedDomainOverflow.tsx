import * as Popover from '@radix-ui/react-popover'
import type { ManagedDomainOverflowProps } from './Types/managed-domain.types.ts'
import useManagedDomainOverflowLogic from './Hooks/useManagedDomainOverflowLogic.ts'

import ManagedDomainLink from './ManagedDomainLink.tsx'

export default function ManagedDomainOverflow({
    ariaLabel,
    domains,
    tone = 'success',
    descriptionId,
}: ManagedDomainOverflowProps) {
    const { handler } = useManagedDomainOverflowLogic()
    if (domains.length === 0) return null

    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    aria-label={ariaLabel}
                    className="inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-neutral px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-muted outline-hidden hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-ring"
                    onClick={handler.handleStopPropagation}
                    onKeyDown={handler.handleStopPropagation}
                    onPointerDown={handler.handleStopPropagation}
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
                    onClick={handler.handleStopPropagation}
                    onKeyDown={handler.handleStopPropagation}
                    onPointerDown={handler.handleStopPropagation}
                >
                    <div className="flex flex-wrap items-center gap-[0.45rem]">
                        {domains.map((domain) => (
                            <ManagedDomainLink
                                className={
                                    `inline-flex items-center rounded-full border px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold ${tone === 'danger' ? 'border-danger-text/20 bg-danger-bg text-danger-text' : 'border-success-text/20 bg-success-bg text-success-text'}` +
                                    ' max-w-64 wrap-anywhere'
                                }
                                domain={domain}
                                aria-describedby={descriptionId}
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
