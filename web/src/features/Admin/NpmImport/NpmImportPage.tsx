import useTranslationStore from '../../../language/useTranslationStore'
import PageHeader from '../../../shared/Management/PageHeader'
import { useNpmImport } from './Hooks/useNpmImport'
import type { NpmImportResultItem, NpmPreviewItem } from './Types/npm-import.types'

function reasonText(reason: string, t: (key: string) => string): string {
    const [code, detail] = reason.split(':', 2)
    const translated = t(`admin.npmImport.reasons.${code}`)
    return detail ? `${translated} (${detail})` : translated
}

function itemDetails(item: NpmPreviewItem | NpmImportResultItem, t: (key: string) => string) {
    return (
        <li
            key={`${item.kind}:${item.sourceId}`}
            className="border-b border-border py-3 last:border-0"
        >
            <div className="flex flex-wrap items-center gap-2">
                <strong className="text-ink">{item.label}</strong>
                <span className="text-xs text-muted">{t(`admin.npmImport.kind.${item.kind}`)}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs font-bold text-ink-soft">
                    {t(`admin.npmImport.status.${item.status}`)}
                </span>
                {'outcome' in item ? (
                    <span className="text-xs font-bold text-ink-soft">
                        {t(`admin.npmImport.${item.outcome}`)}
                    </span>
                ) : null}
            </div>
            {item.reasons.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">
                    {item.reasons.map((reason) => (
                        <li key={reason}>{reasonText(reason, t)}</li>
                    ))}
                </ul>
            ) : null}
        </li>
    )
}

export default function NpmImportPage() {
    const { t } = useTranslationStore()
    const {
        file,
        preview,
        result,
        history,
        busy,
        error,
        selectFile,
        discardPreview,
        previewSource,
        applySource,
    } = useNpmImport()

    return (
        <div className="grid gap-5">
            <PageHeader
                eyebrow={t('admin.npmImport.eyebrow')}
                title={t('admin.npmImport.title')}
                description={t('admin.npmImport.description')}
            />
            <section
                className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                aria-labelledby="npm-source-title"
            >
                <h2 id="npm-source-title" className="text-lg font-extrabold text-ink">
                    {t('admin.npmImport.sourceTitle')}
                </h2>
                <p className="mt-2 text-sm text-ink-soft">{t('admin.npmImport.sourceHelp')}</p>
                <label className="mt-5 grid gap-2 text-sm font-bold text-ink-soft">
                    {t('admin.npmImport.fileLabel')}
                    <input
                        type="file"
                        accept=".sqlite,.db,application/vnd.sqlite3"
                        className="box-border w-full rounded-xl border border-input-border bg-surface-raised px-3 text-sm text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-muted-soft aria-invalid:border-red-500 disabled:cursor-not-allowed disabled:opacity-[0.55] focus:border-accent-border focus:outline-hidden focus:ring-[3px] focus:ring-accent-ring/20 motion-reduce:transition-none h-12"
                        disabled={busy !== null}
                        onChange={(event) => {
                            selectFile(event.currentTarget.files?.[0] ?? null)
                        }}
                    />
                </label>
                <div className="mt-5 flex flex-wrap gap-3">
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                        disabled={!file || busy !== null}
                        onClick={() => void previewSource()}
                    >
                        {busy === 'preview' ? t('common.working') : t('admin.npmImport.preview')}
                    </button>
                </div>
                {error ? (
                    <p role="alert" className="mt-4 text-sm text-danger-text">
                        {t(`admin.npmImport.errors.${error}`)}
                    </p>
                ) : null}
            </section>
            {preview ? (
                <section
                    className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                    aria-labelledby="npm-preview-title"
                >
                    <h2 id="npm-preview-title" className="text-lg font-extrabold text-ink">
                        {t('admin.npmImport.previewTitle')}
                    </h2>
                    <p className="mt-2 text-sm text-ink-soft">{t('admin.npmImport.previewHelp')}</p>
                    <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
                        {Object.entries(preview.counts).map(([status, count]) => (
                            <span
                                key={status}
                                className="inline-flex items-center rounded-full border border-success-text/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text"
                            >
                                {count} {t(`admin.npmImport.status.${status}`)}
                            </span>
                        ))}
                    </div>
                    <details className="mt-5" open>
                        <summary className="cursor-pointer font-bold text-ink">
                            {t('admin.npmImport.details')}
                        </summary>
                        <ul className="mt-2 max-h-[32rem] overflow-y-auto">
                            {preview.items.map((item) => itemDetails(item, t))}
                        </ul>
                    </details>
                    <div className="mt-5 flex flex-wrap gap-3">
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                            disabled={
                                busy !== null || preview.counts.ready + preview.counts.partial === 0
                            }
                            onClick={() => void applySource()}
                        >
                            {busy === 'apply' ? t('common.working') : t('admin.npmImport.apply')}
                        </button>
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            disabled={busy !== null}
                            onClick={discardPreview}
                        >
                            {t('common.cancel')}
                        </button>
                    </div>
                </section>
            ) : null}
            {result ? (
                <section
                    className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                    aria-live="polite"
                >
                    <h2 className="text-lg font-extrabold text-ink">
                        {t('admin.npmImport.resultTitle')}
                    </h2>
                    <p className="mt-2 text-sm text-ink-soft">
                        {t('admin.npmImport.resultSummary', {
                            imported: result.imported,
                            skipped: result.skipped,
                            failed: result.failed,
                            runtime: t(`admin.npmImport.runtime.${result.runtimeStatus}`),
                        })}
                    </p>
                    <details className="mt-4">
                        <summary className="cursor-pointer font-bold text-ink">
                            {t('admin.npmImport.details')}
                        </summary>
                        <ul className="mt-2">{result.items.map((item) => itemDetails(item, t))}</ul>
                    </details>
                </section>
            ) : null}
            {history.length > 0 ? (
                <section className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface">
                    <h2 className="text-lg font-extrabold text-ink">
                        {t('admin.npmImport.history')}
                    </h2>
                    <ul className="mt-3 grid gap-2 text-sm text-ink-soft">
                        {history.map((entry) => (
                            <li key={entry.runId}>
                                <details>
                                    <summary className="cursor-pointer">
                                        {entry.imported} {t('admin.npmImport.imported')},{' '}
                                        {entry.skipped} {t('admin.npmImport.skipped')},{' '}
                                        {entry.failed} {t('admin.npmImport.failed')}
                                        {' · '}
                                        {t(`admin.npmImport.runtime.${entry.runtimeStatus}`)}
                                    </summary>
                                    <ul className="mt-2 pl-4">
                                        {entry.items.map((item) => itemDetails(item, t))}
                                    </ul>
                                </details>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    )
}
