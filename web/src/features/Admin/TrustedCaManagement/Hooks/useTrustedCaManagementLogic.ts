import { invalidateTrustedCaManagementCache } from '@/lib/Admin/TrustedCaManagement/trustedCaManagementCache.ts'
import { invalidateProxyHostManagementCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { invalidateProxyHostManagementRuntimeStatusCache } from '@/lib/Admin/ProxyHostManagement/proxyHostManagementCache.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { TrustedCaSummary } from '@/lib/Admin/TrustedCaManagement/Types/trusted-cas.types.ts'
import { trustedCaManagementQueryKeys } from '@/lib/Admin/TrustedCaManagement/trustedCaManagementCache.ts'
import { deleteTrustedCaHandler, getTrustedCasHandler } from '../middleware.ts'
import type {
    TrustedCaManagementPageProps,
    TrustedCaManagementLogicResult,
} from '../Types/trusted-ca-management.types.ts'

const EMPTY_TRUSTED_CAS: readonly TrustedCaSummary[] = []

export default function useTrustedCaManagementLogic({
    permissions,
}: TrustedCaManagementPageProps): TrustedCaManagementLogicResult {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const trustedCasQuery = useQuery({
        queryKey: trustedCaManagementQueryKeys.all,
        queryFn: () => getTrustedCasHandler(),
        enabled: permissions.includes(PERMISSIONS.TRUSTED_CAS_VIEW),
    })
    const [importOpen, setImportOpen] = useState(false)
    const [replaceTarget, setReplaceTarget] = useState<TrustedCaSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<TrustedCaSummary | null>(null)
    const invalidate = useCallback(async () => {
        await Promise.all([
            invalidateTrustedCaManagementCache(queryClient),
            invalidateProxyHostManagementCache(queryClient),
            invalidateProxyHostManagementRuntimeStatusCache(queryClient),
        ])
    }, [queryClient])
    const deleteMutation = useMutation({
        mutationFn: (trustedCaId: string) => deleteTrustedCaHandler({ data: { trustedCaId } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidate()
            toast.success(t(result.message), { title: t('toast.titles.success') })
            setDeleteTarget(null)
        },
        onError: () =>
            toast.error(t('admin.trustedCas.errors.deleteFailed'), {
                title: t('toast.titles.error'),
            }),
    })
    const handleFormSuccess = useCallback(async () => {
        await invalidate()
        setImportOpen(false)
        setReplaceTarget(null)
    }, [invalidate])
    return {
        state: {
            trustedCas: trustedCasQuery.data ?? EMPTY_TRUSTED_CAS,
            canCreate: permissions.includes(PERMISSIONS.TRUSTED_CAS_CREATE),
            canUpdate: permissions.includes(PERMISSIONS.TRUSTED_CAS_UPDATE),
            canDelete: permissions.includes(PERMISSIONS.TRUSTED_CAS_DELETE),
            isLoading: trustedCasQuery.isPending,
            isError: trustedCasQuery.isError,
            isMutating: deleteMutation.isPending,
            importOpen,
            replaceTarget,
            deleteTarget,
        },
        handler: {
            handleFormSuccess,
            openImport: () => setImportOpen(true),
            openReplace: (trustedCa: TrustedCaSummary) => setReplaceTarget(trustedCa),
            openDelete: (trustedCa: TrustedCaSummary) => {
                deleteMutation.reset()
                setDeleteTarget(trustedCa)
            },
            setImportOpen,
            setReplaceOpen: (open: boolean) => {
                if (!open) setReplaceTarget(null)
            },
            setDeleteOpen: (open: boolean) => {
                if (!open) setDeleteTarget(null)
            },
            confirmDelete: async () => {
                if (deleteTarget)
                    await deleteMutation.mutateAsync(deleteTarget.id).catch(() => undefined)
            },
            retry: () => {
                void trustedCasQuery.refetch()
            },
        },
    }
}
