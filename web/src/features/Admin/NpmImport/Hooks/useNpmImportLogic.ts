import { toast } from '@rentnerkev/toasts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { NpmImportLogicResult } from '../Types/npm-import-logic.types.ts'
import { useImportWorkflow } from '@/shared/Imports/Hooks/useImportWorkflow.ts'

export function useNpmImportLogic(): NpmImportLogicResult {
    const { t } = useTranslationStore()
    const { state, handler } = useImportWorkflow({
        endpoint: '/api/npm-import',
        errorNamespace: 'npmImport',
        importHeader: 'sqlite',
        maxFileBytes: 32 * 1024 * 1024,
        onError: (code) => {
            toast.error(t(`admin.npmImport.errors.${code}`), {
                title: t('toast.titles.error'),
            })
        },
        onApplied: (next) => {
            const summary = t('admin.npmImport.resultSummary', {
                imported: next.imported,
                skipped: next.skipped,
                failed: next.failed,
                runtime: t(`admin.npmImport.runtime.${next.runtimeStatus}`),
            })
            if (next.failed > 0) {
                toast.warning(summary, { title: t('toast.titles.warning') })
            } else {
                toast.success(summary, { title: t('toast.titles.success') })
            }
        },
    })
    return {
        state: {
            file: state.file,
            preview: state.preview,
            result: state.result,
            busy: state.busy,
        },
        handler: {
            selectFile: handler.selectFile,
            discardPreview: handler.discardPreview,
            previewSource: handler.previewSource,
            applySource: handler.applySource,
        },
    }
}
