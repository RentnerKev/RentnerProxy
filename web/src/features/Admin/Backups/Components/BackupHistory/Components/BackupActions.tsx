import { Menu } from '@rentnerkev/menu'
import { EllipsisVertical } from 'lucide-react'
import type { BackupActionsProps } from '../Types/backup-history.types.ts'

export default function BackupActions({ label, items }: BackupActionsProps) {
    return (
        <Menu
            ariaLabel={label}
            items={items}
            openOnHover
            align="end"
            sideOffset={6}
            collisionPadding={8}
            portalZIndex={90}
            classNames={{
                trigger:
                    'inline-flex size-12 items-center justify-center rounded-xl border border-transparent text-muted hover:border-border-strong hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring',
                content:
                    'rounded-xl shadow-panel [--rentner-foreground:var(--theme-ink-soft)] [--rentner-surface:var(--theme-surface-raised)] [--rentner-control:var(--theme-surface-hover)] [--rentner-border:var(--theme-border)] [--rentner-muted:var(--theme-muted)] [--rentner-danger:var(--theme-danger-text)]',
                item: 'min-h-12 rounded-lg px-3 aria-disabled:opacity-45 data-[danger=true]:focus:bg-danger-bg data-[danger=true]:hover:bg-danger-bg',
                label: 'font-bold leading-snug',
                description: 'font-normal leading-snug',
            }}
            trigger={<EllipsisVertical aria-hidden="true" className="size-5" />}
        />
    )
}
