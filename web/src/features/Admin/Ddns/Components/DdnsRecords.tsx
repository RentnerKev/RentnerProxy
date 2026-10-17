import { CheckboxInput } from '@rentnerkev/inputs'
import { ArrowRight, Trash2 } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type useDdnsLogic from '../Hooks/useDdnsLogic.ts'

export default function DdnsRecords({ state, handler }: ReturnType<typeof useDdnsLogic>) {
    const { t } = useTranslationStore()
    return (
        <section
            aria-labelledby={`${state.formId}-records`}
            className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface"
        >
            <div className="border-b border-border p-5 sm:p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2
                        id={`${state.formId}-records`}
                        className="text-lg font-extrabold text-ink-soft"
                    >
                        {t('admin.ddns.records.title')}
                    </h2>
                    <span className="font-mono text-xs text-muted">{state.rows.length} / 100</span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                    {t('admin.ddns.records.scope')}
                </p>
            </div>
            {state.rows.length === 0 ? (
                <p className="p-6 text-sm text-muted">{t('admin.ddns.records.empty')}</p>
            ) : (
                <ul className="divide-y divide-border">
                    {state.rows.map((row) => (
                        <li key={row.target.id} className="grid min-w-0 gap-4 p-5 sm:p-6">
                            <div className="flex min-w-0 flex-wrap items-start gap-3">
                                <span className="rounded-md border border-accent-border bg-accent-muted px-2 py-1 font-mono text-xs font-bold text-accent-ring">
                                    {row.target.recordType}
                                </span>
                                <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-0">
                                    <h3 className="break-all font-mono text-sm font-bold text-ink-soft">
                                        {row.target.name}
                                    </h3>
                                    <p className="mt-1 break-words text-xs text-muted">
                                        {row.connectionLabel} · {row.zone}
                                    </p>
                                </div>
                                {state.editing ? (
                                    <>
                                        <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
                                            <CheckboxInput
                                                aria-label={t('admin.ddns.records.proxyFor', {
                                                    name: row.target.name,
                                                    type: row.target.recordType,
                                                })}
                                                checked={row.target.proxied}
                                                onChange={(event) =>
                                                    handler.setProxied(
                                                        row.target.id,
                                                        event.target.checked,
                                                    )
                                                }
                                                disabled={state.locked}
                                            />
                                            {t('admin.ddns.records.proxied')}
                                        </label>
                                        <button
                                            type="button"
                                            aria-label={t('admin.ddns.records.removeFor', {
                                                name: row.target.name,
                                                type: row.target.recordType,
                                            })}
                                            onClick={() => handler.remove(row.target.id)}
                                            disabled={state.locked}
                                            className="grid size-11 shrink-0 place-items-center rounded-xl border border-border text-danger-text disabled:opacity-50"
                                        >
                                            <Trash2 aria-hidden="true" className="size-4" />
                                        </button>
                                    </>
                                ) : (
                                    <span className="py-1 text-xs font-bold text-muted">
                                        {t(
                                            row.target.proxied
                                                ? 'admin.ddns.records.proxied'
                                                : 'admin.ddns.records.dnsOnly',
                                        )}
                                    </span>
                                )}
                            </div>
                            {row.result ? (
                                <div
                                    className="grid gap-2 rounded-xl border border-border bg-surface-subtle p-3"
                                    aria-label={t('admin.ddns.preview.record')}
                                >
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                                        <span className="text-muted">
                                            {t('admin.ddns.preview.current')}
                                        </span>
                                        <code className="break-all text-ink-soft">
                                            {row.result.current?.address ??
                                                t('admin.ddns.preview.absent')}
                                        </code>
                                        {row.result.current ? (
                                            <span className="text-muted">
                                                {t(
                                                    row.result.current.proxied
                                                        ? 'admin.ddns.records.proxied'
                                                        : 'admin.ddns.records.dnsOnly',
                                                )}
                                            </span>
                                        ) : null}
                                        <ArrowRight
                                            aria-hidden="true"
                                            className="size-3 text-muted"
                                        />
                                        <span className="text-muted">
                                            {t('admin.ddns.preview.desired')}
                                        </span>
                                        <code className="break-all text-ink-soft">
                                            {row.result.desiredAddress ?? '—'}
                                        </code>
                                        <span className="text-muted">
                                            {t(
                                                row.target.proxied
                                                    ? 'admin.ddns.records.proxied'
                                                    : 'admin.ddns.records.dnsOnly',
                                            )}
                                        </span>
                                    </div>
                                    <p
                                        className={
                                            row.result.status === 'failed'
                                                ? 'text-sm font-bold text-danger-text'
                                                : 'text-sm font-bold text-ink-soft'
                                        }
                                    >
                                        {t(`admin.ddns.results.${row.result.status}`)}
                                    </p>
                                    {row.result.error ? (
                                        <p className="text-sm leading-relaxed text-muted">
                                            {t(`admin.ddns.recordErrors.${row.result.error}`)}
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                            {!state.editing ? (
                                <>
                                    <div className="flex flex-wrap items-center gap-3 text-sm">
                                        <span
                                            className={
                                                row.statusKey === 'attention' ||
                                                row.statusKey === 'failed'
                                                    ? 'font-bold text-danger-text'
                                                    : 'font-bold text-ink-soft'
                                            }
                                        >
                                            {t(`admin.ddns.results.${row.statusKey}`)}
                                        </span>
                                        <code className="break-all text-muted">
                                            {row.status?.lastSuccessfulAddress ?? '—'}
                                        </code>
                                        {row.status?.lastSuccessfulProxied != null ? (
                                            <span className="text-xs text-muted">
                                                {t(
                                                    row.status.lastSuccessfulProxied
                                                        ? 'admin.ddns.records.proxied'
                                                        : 'admin.ddns.records.dnsOnly',
                                                )}
                                            </span>
                                        ) : null}
                                    </div>
                                    <dl className="grid gap-3 text-xs sm:grid-cols-3">
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.ddns.status.lastAttempt')}
                                            </dt>
                                            <dd className="mt-1 text-ink-soft">
                                                {row.lastAttempt}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.ddns.status.lastSuccess')}
                                            </dt>
                                            <dd className="mt-1 text-ink-soft">
                                                {row.lastSuccess}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">
                                                {t('admin.ddns.status.nextAttempt')}
                                            </dt>
                                            <dd className="mt-1 text-ink-soft">
                                                {row.nextAttempt}
                                            </dd>
                                        </div>
                                    </dl>
                                    {row.status?.lastResult?.error ? (
                                        <p className="text-sm text-muted">
                                            {t(
                                                `admin.ddns.recordErrors.${row.status.lastResult.error}`,
                                            )}
                                        </p>
                                    ) : null}
                                </>
                            ) : (
                                <p className="text-xs text-muted">
                                    {t(
                                        !row.active
                                            ? 'admin.ddns.results.familyPaused'
                                            : row.target.selection.mode === 'inspect'
                                              ? 'admin.ddns.records.inspect'
                                              : row.target.selection.mode === 'create'
                                                ? 'admin.ddns.records.create'
                                                : 'admin.ddns.records.adopt',
                                    )}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    )
}
