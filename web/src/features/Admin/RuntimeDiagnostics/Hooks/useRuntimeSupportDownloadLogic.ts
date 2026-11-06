import { useEffect, useRef, useState } from 'react'
import { toast } from '@rentnerkev/toasts'

import {
    canExportRuntimeSupportReport,
    serializeRuntimeSupportReport,
} from '@/lib/RuntimeDiagnostics/runtimeSupportReport.ts'
import { exportRuntimeSupportReportHandler } from '../middleware.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    RuntimeSupportDownloadLogic,
    RuntimeSupportDownloadProps,
} from '../Types/runtime-support-download.types.ts'

export default function useRuntimeSupportDownloadLogic({
    permissions,
}: RuntimeSupportDownloadProps): RuntimeSupportDownloadLogic {
    const canExport = canExportRuntimeSupportReport(permissions)
    const { t } = useTranslationStore()
    const exporting = useRef(false)
    const active = useRef(false)
    const generation = useRef(0)
    const [isExporting, setIsExporting] = useState(false)
    useEffect(() => {
        active.current = canExport
        return () => {
            active.current = false
            generation.current += 1
        }
    }, [canExport])

    async function downloadReport(): Promise<void> {
        if (!canExport || !active.current || exporting.current) return
        exporting.current = true
        const attempt = generation.current
        setIsExporting(true)
        let href: string | null = null
        try {
            const report = await exportRuntimeSupportReportHandler()
            if (!active.current || generation.current !== attempt) return
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
            if (report.completeness === 'partial') {
                toast.warning(t('admin.runtimeDiagnostics.downloadPartial'), {
                    title: t('toast.titles.warning'),
                })
            } else {
                toast.success(t('admin.runtimeDiagnostics.downloadComplete'), {
                    title: t('toast.titles.success'),
                })
            }
        } catch {
            if (!active.current || generation.current !== attempt) return
            toast.error(t('admin.runtimeDiagnostics.downloadFailed'), {
                title: t('toast.titles.error'),
            })
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
        state: { canExport, isExporting },
        handler: {
            handleDownload: () => {
                void downloadReport()
            },
        },
    }
}
