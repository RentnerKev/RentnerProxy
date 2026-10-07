import type { MigrationLogicResult } from '../Types/migration.types.ts'
import { useEffect, useState } from 'react'
import { toast } from '@rentnerkev/toasts/toast'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    ImportResponseError,
    getImportRequestErrorCode,
} from '@/lib/Admin/Migration/importRequestErrors.ts'
import type {
    NpmImportPreview,
    NpmImportResult,
} from '@/features/Admin/NpmImport/Types/npm-import.types.ts'

import type { MigrationSource } from '../Types/migration.types.ts'

const MAX_FILE_BYTES = 32 * 1024 * 1024

async function loadHistory(): Promise<NpmImportResult[]> {
    const response = await fetch('/api/migration', { credentials: 'same-origin' })
    return response.ok ? (response.json() as Promise<NpmImportResult[]>) : []
}

async function upload(
    file: File,
    mode: 'preview' | 'apply',
    source: MigrationSource,
    preview?: NpmImportPreview,
): Promise<unknown> {
    const query = new URLSearchParams({
        mode,
        source,
        ...(preview ? { fingerprint: preview.fingerprint, plan: preview.planFingerprint } : {}),
    })
    const response = await fetch(`/api/migration?${query}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-RentnerProxy-Import': source },
        body: file,
    })
    const data: unknown = await response.json()
    if (!response.ok) {
        throw new ImportResponseError(data, 'migration')
    }
    return data
}

export function useMigrationLogic(): MigrationLogicResult {
    const { t } = useTranslationStore()
    const [source, setSource] = useState<MigrationSource>('rentnerproxy')
    const [file, setFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<NpmImportPreview | null>(null)
    const [result, setResult] = useState<NpmImportResult | null>(null)
    const [history, setHistory] = useState<readonly NpmImportResult[]>([])
    const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
    const [exporting, setExporting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        void loadHistory()
            .then(setHistory)
            .catch(() => undefined)
    }, [])

    function selectFile(next: File | null): void {
        setFile(next)
        setPreview(null)
        setResult(null)
        setError(null)
    }

    function selectSource(next: MigrationSource): void {
        setSource(next)
        selectFile(null)
    }

    async function downloadExport(): Promise<void> {
        if (exporting) return
        setError(null)
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
            setError('export_failed')
            toast.error(t('admin.migration.errors.export_failed'), {
                title: t('toast.titles.error'),
            })
        } finally {
            setExporting(false)
        }
    }

    async function run(mode: 'preview' | 'apply'): Promise<void> {
        if (!file || busy) return
        setError(null)
        if (file.size > (source === 'rentnerproxy' ? 4 * 1024 * 1024 : MAX_FILE_BYTES)) {
            setError('source_limit')
            toast.error(t('admin.migration.errors.source_limit'), {
                title: t('toast.titles.error'),
            })
            return
        }
        setBusy(mode)
        try {
            if (mode === 'preview') {
                const next = (await upload(file, 'preview', source)) as NpmImportPreview
                setPreview(next)
                setResult(null)
            } else if (preview) {
                const next = (await upload(file, 'apply', source, preview)) as NpmImportResult
                setResult(next)
                setPreview(null)
                setHistory((current) => [next, ...current].slice(0, 20))
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
            }
        } catch (caught) {
            const code = getImportRequestErrorCode(caught)
            setError(code)
            toast.error(t(`admin.migration.errors.${code}`), {
                title: t('toast.titles.error'),
            })
            if (mode === 'apply') {
                setPreview(null)
                void loadHistory()
                    .then(setHistory)
                    .catch(() => undefined)
            }
        } finally {
            setBusy(null)
        }
    }

    return {
        state: { source, exporting, file, preview, result, history, busy, error },
        handler: {
            selectSource: selectSource,
            downloadExport: downloadExport,
            selectFile: selectFile,
            discardPreview: () => setPreview(null),
            previewSource: () => run('preview'),
            applySource: () => run('apply'),
        },
    }
}
