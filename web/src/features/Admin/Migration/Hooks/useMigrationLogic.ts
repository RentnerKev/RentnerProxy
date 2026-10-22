import type { MigrationLogicResult } from '../Types/migration.types.ts'
import { useState } from 'react'
import { toast } from '@rentnerkev/toasts'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { useImportWorkflow } from '@/shared/Imports/Hooks/useImportWorkflow.ts'

import type { MigrationSource } from '../Types/migration.types.ts'

export function useMigrationLogic(): MigrationLogicResult {
    const { t } = useTranslationStore()
    const [source, setSource] = useState<MigrationSource>('rentnerproxy')
    const [exporting, setExporting] = useState(false)
    const { state, handler, setter } = useImportWorkflow({
        endpoint: '/api/migration',
        errorNamespace: 'migration',
        source,
        importHeader: source,
        maxFileBytes: (source === 'rentnerproxy' ? 4 : 32) * 1024 * 1024,
        onError: (code) => {
            toast.error(t(`admin.migration.errors.${code}`), {
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

    function selectSource(next: MigrationSource): void {
        setSource(next)
        handler.selectFile(null)
    }

    async function downloadExport(): Promise<void> {
        if (exporting) return
        setter.setError(null)
        setExporting(true)
        try {
            const response = await fetch('/api/migration/export', { credentials: 'same-origin' })
            if (!response.ok) throw new Error('export_failed')
            const blob = await response.blob()
            const href = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = href
            link.download = `rentnerproxy-config-${new Date().toISOString().slice(0, 10)}.json`
            document.body.append(link)
            link.click()
            link.remove()
            setTimeout(() => URL.revokeObjectURL(href), 60_000)
            toast.success(t('admin.migration.exportCompleted'), {
                title: t('toast.titles.success'),
            })
        } catch {
            setter.setError('export_failed')
            toast.error(t('admin.migration.errors.export_failed'), {
                title: t('toast.titles.error'),
            })
        } finally {
            setExporting(false)
        }
    }

    return {
        state: { ...state, source, exporting },
        handler: { ...handler, selectSource, downloadExport },
    }
}
