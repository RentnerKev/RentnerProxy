import ImportPreviewPanel from '@/shared/Imports/Components/ImportPreviewPanel.tsx'
import ImportResultPanel from '@/shared/Imports/Components/ImportResultPanel.tsx'
import ImportHistoryPanel from '@/shared/Imports/Components/ImportHistoryPanel.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { useNpmImportLogic } from './Hooks/useNpmImportLogic.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function NpmImportPage() {
    const { t } = useTranslationStore()
    const { state, handler } = useNpmImportLogic()

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
                        disabled={state.busy !== null}
                        onChange={(event) => {
                            handler.selectFile(event.currentTarget.files?.[0] ?? null)
                        }}
                    />
                </label>
                <div className="mt-5 flex flex-wrap gap-3">
                    <button
                        type="button"
                        className={buttonClassName('primary')}
                        disabled={!state.file || state.busy !== null}
                        onClick={() => void handler.previewSource()}
                    >
                        {state.busy === 'preview'
                            ? t('common.working')
                            : t('admin.npmImport.preview')}
                    </button>
                </div>
                {state.error ? (
                    <p role="alert" className="mt-4 text-sm text-danger-text">
                        {t(`admin.npmImport.errors.${state.error}`)}
                    </p>
                ) : null}
            </section>
            {state.preview ? (
                <ImportPreviewPanel
                    preview={state.preview}
                    busy={state.busy}
                    help={t('admin.npmImport.previewHelp')}
                    onApply={handler.applySource}
                    onDiscard={handler.discardPreview}
                />
            ) : null}
            {state.result ? <ImportResultPanel result={state.result} /> : null}
            {state.history.length > 0 ? <ImportHistoryPanel history={state.history} /> : null}
        </div>
    )
}
