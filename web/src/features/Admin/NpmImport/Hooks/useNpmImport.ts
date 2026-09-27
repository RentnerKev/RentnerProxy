import { useEffect, useState } from 'react'

import type { NpmImportPreview, NpmImportResult } from '../Types/npm-import.types'

const MAX_FILE_BYTES = 32 * 1024 * 1024

async function loadHistory(): Promise<NpmImportResult[]> {
    const response = await fetch('/api/npm-import', { credentials: 'same-origin' })
    return response.ok ? (response.json() as Promise<NpmImportResult[]>) : []
}

async function upload(
    file: File,
    mode: 'preview' | 'apply',
    preview?: NpmImportPreview,
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
        const code =
            data && typeof data === 'object' && 'error' in data
                ? String(data.error)
                : 'import_failed'
        throw new Error(code)
    }
    return data
}

export function useNpmImport() {
    const [file, setFile] = useState<File | null>(null)
    const [preview, setPreview] = useState<NpmImportPreview | null>(null)
    const [result, setResult] = useState<NpmImportResult | null>(null)
    const [history, setHistory] = useState<readonly NpmImportResult[]>([])
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
                const next = (await upload(file, 'preview')) as NpmImportPreview
                setPreview(next)
                setResult(null)
            } else if (preview) {
                const next = (await upload(file, 'apply', preview)) as NpmImportResult
                setResult(next)
                setPreview(null)
                setHistory((current) => [next, ...current].slice(0, 20))
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'import_failed')
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
        file,
        preview,
        result,
        history,
        busy,
        error,
        selectFile,
        discardPreview: () => setPreview(null),
        previewSource: () => run('preview'),
        applySource: () => run('apply'),
    }
}
