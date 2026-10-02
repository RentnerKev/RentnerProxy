import type { CertificateManagementLogicResult } from '../../../Types/certificate-management.types.ts'
import { invalidateCertificateManagementCache } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import { invalidateProxyHostManagementCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { invalidateProxyHostManagementRuntimeStatusCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { invalidateRedirectHostManagementCache } from '@/lib/Admin/RedirectHostManagement/redirectHostManagementCache.ts'
import { invalidateRedirectHostManagementRuntimeStatusCache } from '@/lib/Admin/RedirectHostManagement/redirectHostManagementCache.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import useLiveInvalidation from '@/shared/Live/useLiveInvalidation.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    CertificateActionResult,
    CertificateSummary,
} from '@/shared/Types/certificates.types.ts'
import type { ProxyHostSummary } from '@/shared/Types/proxy-hosts.types.ts'
import {
    deleteCertificateHandler,
    getCertificatesHandler,
    renewCertificateHandler,
} from '../../../middleware.ts'
import { certificateManagementQueryKeys } from '@/lib/Admin/CertificateManagement/certificateManagementCache.ts'
import type { CertificateManagementPageProps } from '../../../Types/certificate-management.types.ts'

const EMPTY_CERTIFICATES: CertificateSummary[] = []

export default function useServerCertificatesLogic({
    permissions,
}: CertificateManagementPageProps): CertificateManagementLogicResult {
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canView = permissionSet.has(PERMISSIONS.CERTIFICATES_VIEW)
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const certificatesQuery = useQuery({
        queryKey: certificateManagementQueryKeys.all,
        queryFn: () => getCertificatesHandler(),
        enabled: canView,
    })
    useLiveInvalidation({
        topic: 'certificates',
        query: {},
        enabled: canView,
        queryKeys: [certificateManagementQueryKeys.all],
    })
    const [importOpen, setImportOpen] = useState(false)
    const [requestOpen, setRequestOpen] = useState(false)
    const [requestDefaults, setRequestDefaults] = useState<{ domains?: string[]; name?: string }>(
        {},
    )
    const [detailsTarget, setDetailsTarget] = useState<CertificateSummary | null>(null)
    const [replaceTarget, setReplaceTarget] = useState<CertificateSummary | null>(null)
    const [renewTarget, setRenewTarget] = useState<CertificateSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<CertificateSummary | null>(null)

    const invalidateCertificateQueries = useCallback(async () => {
        await Promise.all([
            invalidateCertificateManagementCache(queryClient),
            invalidateProxyHostManagementCache(queryClient),
            invalidateProxyHostManagementRuntimeStatusCache(queryClient),
            invalidateRedirectHostManagementCache(queryClient),
            invalidateRedirectHostManagementRuntimeStatusCache(queryClient),
        ])
    }, [queryClient])
    const handleActionResult = useCallback(
        async (result: CertificateActionResult, onSuccess?: () => void) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return false
            }
            await invalidateCertificateQueries()
            toast.success(t(result.message), { title: t('toast.titles.success') })
            onSuccess?.()
            return true
        },
        [invalidateCertificateQueries, t],
    )
    const renewMutation = useMutation({
        mutationFn: (certificateId: string) => renewCertificateHandler({ data: { certificateId } }),
        onSuccess: async (result) => {
            await handleActionResult(result, () => setRenewTarget(null))
        },
        onError: () =>
            toast.error(t('admin.certificates.errors.renewFailed'), {
                title: t('toast.titles.error'),
            }),
    })
    const deleteMutation = useMutation({
        mutationFn: (certificateId: string) =>
            deleteCertificateHandler({ data: { certificateId } }),
        onSuccess: async (result) => {
            await invalidateCertificateQueries()
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            toast[result.runtimeStatus === 'pending' ? 'warning' : 'success'](t(result.message), {
                title: t(
                    'toast.titles.' + (result.runtimeStatus === 'pending' ? 'warning' : 'success'),
                ),
            })
            setDeleteTarget(null)
        },
        onError: async () => {
            await invalidateCertificateQueries()
            toast.error(t('admin.certificates.errors.deleteFailed'), {
                title: t('toast.titles.error'),
            })
        },
    })
    const openImport = useCallback(() => {
        setReplaceTarget(null)
        setImportOpen(true)
    }, [])
    const setImportDialogOpen = useCallback((open: boolean) => {
        if (!open) setImportOpen(false)
    }, [])
    const openRequest = useCallback((host?: ProxyHostSummary) => {
        setRequestDefaults(host ? { domains: [...host.domains], name: host.domains[0] ?? '' } : {})
        setRequestOpen(true)
    }, [])
    const setRequestDialogOpen = useCallback((open: boolean) => {
        if (!open) setRequestOpen(false)
    }, [])
    const openDetails = useCallback(
        (certificate: CertificateSummary) => setDetailsTarget(certificate),
        [],
    )
    const openReplace = useCallback(
        (certificate: CertificateSummary) => setReplaceTarget(certificate),
        [],
    )
    const openRenew = useCallback(
        (certificate: CertificateSummary) => {
            renewMutation.reset()
            setRenewTarget(certificate)
        },
        [renewMutation],
    )
    const openDelete = useCallback(
        (certificate: CertificateSummary) => {
            deleteMutation.reset()
            setDeleteTarget(certificate)
        },
        [deleteMutation],
    )
    const setDetailsDialogOpen = useCallback((open: boolean) => {
        if (!open) setDetailsTarget(null)
    }, [])
    const setReplaceDialogOpen = useCallback((open: boolean) => {
        if (!open) setReplaceTarget(null)
    }, [])
    const setRenewDialogOpen = useCallback(
        (open: boolean) => {
            if (!open) {
                renewMutation.reset()
                setRenewTarget(null)
            }
        },
        [renewMutation],
    )
    const setDeleteDialogOpen = useCallback(
        (open: boolean) => {
            if (!open) {
                deleteMutation.reset()
                setDeleteTarget(null)
            }
        },
        [deleteMutation],
    )
    const confirmRenew = useCallback(async () => {
        if (renewTarget) await renewMutation.mutateAsync(renewTarget.id).catch(() => undefined)
    }, [renewMutation, renewTarget])
    const confirmDelete = useCallback(async () => {
        if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id).catch(() => undefined)
    }, [deleteMutation, deleteTarget])
    const handleFormSuccess = useCallback(async () => {
        await invalidateCertificateQueries()
        setImportOpen(false)
        setReplaceTarget(null)
        setRequestOpen(false)
    }, [invalidateCertificateQueries])
    const retry = useCallback(() => {
        void certificatesQuery.refetch()
    }, [certificatesQuery])
    const currentDetailsTarget = detailsTarget
        ? (certificatesQuery.data?.find((certificate) => certificate.id === detailsTarget.id) ??
          detailsTarget)
        : null

    return {
        state: {
            certificates: certificatesQuery.data ?? EMPTY_CERTIFICATES,
            canCreate: permissionSet.has(PERMISSIONS.CERTIFICATES_CREATE),
            canDelete: permissionSet.has(PERMISSIONS.CERTIFICATES_DELETE),
            canIssue: permissionSet.has(PERMISSIONS.CERTIFICATES_ISSUE),
            canRenew: permissionSet.has(PERMISSIONS.CERTIFICATES_RENEW),
            canUpdate: permissionSet.has(PERMISSIONS.CERTIFICATES_UPDATE),
            deleteTarget,
            detailsTarget: currentDetailsTarget,
            importOpen,
            isDeleting: deleteMutation.isPending,
            isError: certificatesQuery.isError,
            isLoading: certificatesQuery.isPending,
            isMutating: renewMutation.isPending || deleteMutation.isPending,
            isRenewing: renewMutation.isPending,
            replaceTarget,
            requestDefaults,
            requestOpen,
            renewTarget,
        },
        handler: {
            confirmDelete,
            confirmRenew,
            handleFormSuccess,
            openDelete,
            openDetails,
            openImport,
            openReplace,
            openRequest,
            openRenew,
            retry,
            setDeleteDialogOpen,
            setDetailsDialogOpen,
            setImportDialogOpen,
            setReplaceDialogOpen,
            setRequestDialogOpen,
            setRenewDialogOpen,
        },
    }
}
