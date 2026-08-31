import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { PERMISSIONS } from '../../../../config/permissions.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { TrustedCaSummary } from '../../../../shared/Types/trusted-cas.types'
import { proxyHostManagementQueryKeys } from '../../ProxyHostManagement/queryKeys'
import { trustedCaManagementQueryKeys } from '../queryKeys'
import { deleteTrustedCaHandler, getTrustedCasHandler } from '../server'
import type { TrustedCaManagementPageProps } from '../Types/trusted-ca-management.types'

const EMPTY_TRUSTED_CAS: readonly TrustedCaSummary[] = []

export default function useTrustedCaManagementLogic({ permissions }: TrustedCaManagementPageProps) {
    const toast = useToast()
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
            queryClient.invalidateQueries({ queryKey: trustedCaManagementQueryKeys.all }),
            queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.all }),
            queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.runtimeStatus }),
        ])
    }, [queryClient])
    const deleteMutation = useMutation({
        mutationFn: (trustedCaId: string) => deleteTrustedCaHandler({ data: { trustedCaId } }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }
            await invalidate()
            toast.success(result.message)
            setDeleteTarget(null)
        },
        onError: () => toast.error('admin.trustedCas.errors.deleteFailed'),
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
