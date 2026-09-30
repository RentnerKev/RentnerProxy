import { FileInput } from '@rentnerkev/inputs'
import { CustomSelect } from '@rentnerkev/select/select'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'

import { TOOLTIP_DEFAULT_PROPS } from '../../../config/tooltip.config'
import useTranslationStore from '../../../language/useTranslationStore'
import PageHeader from '../../../shared/Management/PageHeader'
import { useMigration, type MigrationSource } from './Hooks/useMigration'
import type { NpmImportResultItem, NpmPreviewItem } from '../NpmImport/Types/npm-import.types'

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

export default function MigrationPage() {
    const { t } = useTranslationStore()
    const {
        source,
        selectSource,
        exporting,
        downloadExport,
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
    } = useMigration()

    return (
        <div className="grid gap-5">
            <PageHeader
                eyebrow={t('admin.migration.eyebrow')}
                title={t('admin.migration.title')}
                description={t('admin.migration.description')}
            />
            <section
                className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                aria-labelledby="migration-export-title"
            >
                <h2 id="migration-export-title" className="text-lg font-extrabold text-ink">
                    {t('admin.migration.exportTitle')}
                </h2>
                <p className="mt-2 text-sm text-ink-soft">{t('admin.migration.exportHelp')}</p>
                <div className="mt-5">
                    <CustomTooltip
                        {...TOOLTIP_DEFAULT_PROPS}
                        content={t('admin.migration.exportHelp')}
                    >
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                            disabled={exporting}
                            onClick={() => void downloadExport()}
                        >
                            {exporting ? t('common.working') : t('admin.migration.exportButton')}
                        </button>
                    </CustomTooltip>
                </div>
                {error === 'export_failed' ? (
                    <p role="alert" className="mt-4 text-sm text-danger-text">
                        {t('admin.migration.errors.export_failed')}
                    </p>
                ) : null}
            </section>
            <section
                className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                aria-labelledby="migration-source-title"
            >
                <h2 id="migration-source-title" className="text-lg font-extrabold text-ink">
                    {t('admin.migration.importTitle')}
                </h2>
                <div className="mt-5 grid gap-2">
                    <label
                        className="text-[0.82rem] font-[750] text-ink-soft"
                        htmlFor="migration-source"
                    >
                        {t('admin.migration.sourceLabel')}
                    </label>
                    <CustomSelect<MigrationSource>
                        id="migration-source"
                        aria-label={t('admin.migration.sourceLabel')}
                        aria-describedby="migration-source-help"
                        value={source}
                        disabled={busy !== null}
                        onValueChange={selectSource}
                        options={[
                            {
                                value: 'rentnerproxy',
                                label: t('admin.migration.source.rentnerproxy'),
                            },
                            { value: 'npm', label: t('admin.migration.source.npm') },
                            { value: 'zoraxy', label: t('admin.migration.source.zoraxy') },
                        ]}
                    />
                </div>
                <p id="migration-source-help" className="mt-3 text-sm text-ink-soft">
                    {t(`admin.migration.sourceHelp.${source}`)}
                </p>
                <div className="mt-5 grid gap-2">
                    <label
                        className="text-[0.82rem] font-[750] text-ink-soft"
                        htmlFor="migration-file"
                    >
                        {t('admin.migration.fileLabel')}
                    </label>
                    <FileInput
                        key={source}
                        id="migration-file"
                        aria-describedby="migration-source-help"
                        type="file"
                        accept={
                            source === 'npm'
                                ? '.sqlite,.db,application/vnd.sqlite3'
                                : source === 'zoraxy'
                                  ? '.zip,application/zip'
                                  : '.json,application/json'
                        }
                        disabled={busy !== null}
                        onChange={(event) => {
                            selectFile(event.currentTarget.files?.[0] ?? null)
                        }}
                    />
                </div>
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
                {error && error !== 'export_failed' ? (
                    <p role="alert" className="mt-4 text-sm text-danger-text">
                        {t(`admin.migration.errors.${error}`)}
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
                    <p className="mt-2 text-sm text-ink-soft">{t('admin.migration.previewHelp')}</p>
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
                        {t(`admin.migration.source.${source}`)}:{' '}
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
                                        {entry.sourceSchema.startsWith('npm')
                                            ? t('admin.migration.source.npm')
                                            : entry.sourceSchema.startsWith('zoraxy')
                                              ? t('admin.migration.source.zoraxy')
                                              : entry.sourceSchema.startsWith('rentnerproxy')
                                                ? t('admin.migration.source.rentnerproxy')
                                                : entry.sourceSchema}{' '}
                                        · {entry.imported} {t('admin.npmImport.imported')},{' '}
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
