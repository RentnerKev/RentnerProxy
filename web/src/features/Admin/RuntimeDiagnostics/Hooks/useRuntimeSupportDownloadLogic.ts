import { useRef, useState } from 'react'

import {
    canExportRuntimeSupportReport,
    serializeRuntimeSupportReport,
} from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import { exportRuntimeSupportReportHandler } from '../middleware.ts'
import type {
    RuntimeSupportDownloadLogic,
    RuntimeSupportDownloadProps,
} from '../Types/runtime-support-download.types.ts'

export default function useRuntimeSupportDownloadLogic({
    permissions,
}: RuntimeSupportDownloadProps): RuntimeSupportDownloadLogic {
    const canExport = canExportRuntimeSupportReport(permissions)
    const exporting = useRef(false)
    const [isExporting, setIsExporting] = useState(false)
    const [feedback, setFeedback] = useState<RuntimeSupportDownloadLogic['state']['feedback']>(null)

    async function downloadReport(): Promise<void> {
        if (!canExport || exporting.current) return
        exporting.current = true
        setIsExporting(true)
        setFeedback(null)
        let href: string | null = null
        try {
            const report = await exportRuntimeSupportReportHandler()
            const blob = new Blob([serializeRuntimeSupportReport(report)], {
                type: 'application/json',
            })
            href = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = href
            link.download = `rentnerproxy-support-${new Date().toISOString().slice(0, 10)}.json`
            document.body.append(link)
            try {
                link.click()
            } finally {
                link.remove()
            }
            setFeedback(report.completeness === 'partial' ? 'partial' : 'complete')
        } catch {
            setFeedback('failed')
        } finally {
            if (href) {
                const downloadUrl = href
                setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000)
            }
            exporting.current = false
            setIsExporting(false)
        }
    }

    return {
        state: { canExport, isExporting, feedback },
        handler: {
            handleDownload: () => {
                void downloadReport()
            },
        },
    }
}
