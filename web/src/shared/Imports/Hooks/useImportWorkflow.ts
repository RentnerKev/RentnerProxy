import { useState } from 'react'
import type { ImportWorkflowOptions } from '../Types/import-workflow.types.ts'
import type { ImportPreview, ImportResult } from '@/lib/Imports/Types/import.types.ts'
import {
    ImportResponseError,
    getImportRequestErrorCode,
} from '@/lib/Admin/Migration/importRequestErrors.ts'

async function upload(
    options: ImportWorkflowOptions,
    file: File,
    mode: 'preview' | 'apply',
    preview?: ImportPreview,
): Promise<unknown> {
    const query = new URLSearchParams({
        mode,
        ...(options.source ? { source: options.source } : {}),
        ...(preview ? { fingerprint: preview.fingerprint, plan: preview.planFingerprint } : {}),
    })
    const response = await fetch(`${options.endpoint}?${query}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-RentnerProxy-Import': options.importHeader,
        },
        body: file,
    })
    const data: unknown = await response.json()
    if (!response.ok) throw new ImportResponseError(data, options.errorNamespace)
    return data
}

export function useImportWorkflow(options: ImportWorkflowOptions) {
    const [file, setFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<ImportPreview | null>(null)
    const [result, setResult] = useState<ImportResult | null>(null)
    const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
    const [error, setError] = useState<string | null>(null)

    function selectFile(next: File | null): void {
        setFile(next)
        setPreview(null)
        setResult(null)
        setError(null)
    }

    async function run(mode: 'preview' | 'apply'): Promise<void> {
        if (!file || busy) return
        setError(null)
        if (file.size > options.maxFileBytes) {
            setError('source_limit')
            options.onError?.('source_limit')
            return
        }
        setBusy(mode)
        try {
            if (mode === 'preview') {
                setPreview((await upload(options, file, 'preview')) as ImportPreview)
                setResult(null)
            } else if (preview) {
                const next = (await upload(options, file, 'apply', preview)) as ImportResult
                setResult(next)
                setPreview(null)
                options.onApplied?.(next)
            }
        } catch (caught) {
            const code = getImportRequestErrorCode(caught)
            setError(code)
            options.onError?.(code)
            if (mode === 'apply') {
                setPreview(null)
            }
        } finally {
            setBusy(null)
        }
    }

    return {
        state: { file, preview, result, busy, error },
        handler: {
            selectFile,
            discardPreview: () => setPreview(null),
            previewSource: () => run('preview'),
            applySource: () => run('apply'),
        },
        setter: { setError },
    }
}
