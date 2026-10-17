import { Cloud, Globe2, Link2, Pencil, Trash2 } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DnsConnectionCardProps } from '../Types/dns-connections-ui.types.ts'

export default function DnsConnectionCard({
    connection,
    canManage,
    isPending,
    onEdit,
    onDelete,
}: DnsConnectionCardProps) {
    const { t } = useTranslationStore()
    return (
        <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-panel transition-colors hover:border-border-strong motion-reduce:transition-none">
            <header className="flex min-w-0 items-start gap-4 p-5 sm:p-6">
                <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-accent-border bg-accent-muted text-accent-ring">
                    <Cloud aria-hidden="true" className="size-6" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="break-words text-xl font-extrabold text-ink-soft">
                        {connection.name}
                    </h2>
                    <p className="mt-1 text-xs font-bold text-muted">
                        {t('admin.dnsConnections.provider')}
                    </p>
                </div>
                <span className="rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-xs font-bold tabular-nums text-muted">
                    {t('admin.dnsConnections.card.zoneCount', { count: connection.zones.length })}
                </span>
            </header>
            <div className="flex flex-1 flex-wrap content-start gap-2 px-5 pb-5 sm:px-6">
                {connection.zones.map((zone) => (
                    <span
                        key={zone.id}
                        className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-sm text-ink-soft"
                    >
                        <Globe2 aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                        <span className="break-all font-mono text-xs">{zone.name}</span>
                    </span>
                ))}
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-subtle px-5 py-3 sm:px-6">
                <span className="inline-flex items-center gap-2 text-xs text-muted">
                    <Link2 aria-hidden="true" className="size-3.5" />
                    {t('admin.dnsConnections.card.references', {
                        count: connection.references.length,
                    })}
                </span>
                {canManage ? (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onEdit(connection)}
                            disabled={isPending}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-bold text-ink-soft hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent-ring disabled:opacity-50"
                        >
                            <Pencil aria-hidden="true" className="size-3.5" />
                            {t('common.edit')}
                        </button>
                        <button
                            type="button"
                            onClick={() => onDelete(connection)}
                            disabled={isPending || connection.references.length > 0}
                            aria-label={t('admin.dnsConnections.card.delete', {
                                name: connection.name,
                            })}
                            title={
                                connection.references.length
                                    ? t('admin.dnsConnections.form.deleteInUse')
                                    : t('admin.dnsConnections.actions.delete')
                            }
                            className="grid size-10 place-items-center rounded-lg text-danger-text hover:bg-danger-bg focus-visible:outline-2 focus-visible:outline-accent-ring disabled:opacity-40"
                        >
                            <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                    </div>
                ) : null}
            </footer>
        </article>
    )
}
