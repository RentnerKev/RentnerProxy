import type { NpmImportLogicResult } from '../Types/npm-import-logic.types.ts'
import { useEffect, useState } from 'react'
import {
    ImportResponseError,
    getImportRequestErrorCode,
} from '@/lib/Admin/Migration/importRequestErrors.ts'

import type { ImportPreview, ImportResult } from '@/lib/Imports/Types/import.types.ts'

const MAX_FILE_BYTES = 32 * 1024 * 1024

async function loadHistory(): Promise<ImportResult[]> {
    const response = await fetch('/api/npm-import', { credentials: 'same-origin' })
    return response.ok ? (response.json() as Promise<ImportResult[]>) : []
}

async function upload(
    file: File,
    mode: 'preview' | 'apply',
    preview?: ImportPreview,
): Promise<unknown> {
    const query = new URLSearchParams({
        mode,
        ...(preview ? { fingerprint: preview.fingerprint, plan: preview.planFingerprint } : {}),
    })
    const response = await fetch(`/api/npm-import?${query}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/octet-stream', 'X-RentnerProxy-Import': 'sqlite' },
        body: file,
    })
    const data: unknown = await response.json()
    if (!response.ok) {
        throw new ImportResponseError(data, 'npmImport')
    }
    return data
}

export function useNpmImportLogic(): NpmImportLogicResult {
    const [file, setFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<ImportPreview | null>(null)
    const [result, setResult] = useState<ImportResult | null>(null)
    const [history, setHistory] = useState<readonly ImportResult[]>([])
    const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
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

    async function run(mode: 'preview' | 'apply'): Promise<void> {
        if (!file || busy) return
        setError(null)
        if (file.size > MAX_FILE_BYTES) {
            setError('source_limit')
            return
        }
        setBusy(mode)
        try {
            if (mode === 'preview') {
                const next = (await upload(file, 'preview')) as ImportPreview
                setPreview(next)
                setResult(null)
            } else if (preview) {
                const next = (await upload(file, 'apply', preview)) as ImportResult
                setResult(next)
                setPreview(null)
                setHistory((current) => [next, ...current].slice(0, 20))
            }
        } catch (caught) {
            setError(getImportRequestErrorCode(caught))
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
        state: { file, preview, result, history, busy, error },
        handler: {
            selectFile: selectFile,
            discardPreview: () => setPreview(null),
            previewSource: () => run('preview'),
            applySource: () => run('apply'),
        },
    }
}
