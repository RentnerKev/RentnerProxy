import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
import { accessPolicyManagementQueryKeys } from '../queryKeys'
import { MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY } from '../../../../config/access-policies.config'
import { deleteBasicAuthAccountHandler, getBasicAuthAccountsHandler } from '../server'
import type {
    BasicAuthAccount,
    BasicAuthAccountsModalProps,
    BasicAuthActionResult,
} from '../Types/basic-auth.types'

const EMPTY_ACCOUNTS: BasicAuthAccount[] = []

export default function useBasicAuthAccountsLogic({
    canUpdate,
    onAccountsChange,
    onOpenChange,
    open,
    policy,
}: BasicAuthAccountsModalProps) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [showForm, setShowForm] = useState(false)
    const [formAccount, setFormAccount] = useState<BasicAuthAccount | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<BasicAuthAccount | null>(null)
    const queryKey = accessPolicyManagementQueryKeys.basicAuthAccounts(policy.id)

    const accountsQuery = useQuery({
        queryKey,
        queryFn: () =>
            getBasicAuthAccountsHandler({
                data: { accessPolicyId: policy.id },
            }),
        enabled: open,
        retry: false,
    })

    const invalidateAccounts = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey, exact: true })
        await onAccountsChange()
    }, [onAccountsChange, queryClient, queryKey])

    const deleteMutation = useMutation({
        gcTime: 0,
        mutationFn: async (account: BasicAuthAccount): Promise<BasicAuthActionResult> =>
            deleteBasicAuthAccountHandler({
                data: {
                    accessPolicyId: policy.id,
                    accountId: account.id,
                },
            }),
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidateAccounts()
            if (result.runtimeStatus === 'pending') {
                toast.warning(t('admin.accessPolicies.basicAuth.messages.savedPending'), {
                    title: t('toast.titles.warning'),
                })
            } else {
                toast.success(t(result.message), { title: t('toast.titles.success') })
            }
            setDeleteTarget(null)
        },
        onError: () =>
            toast.error(t('admin.accessPolicies.basicAuth.errors.deleteFailed'), {
                title: t('toast.titles.error'),
            }),
    })

    const openCreate = useCallback(() => {
        if (!canUpdate || (accountsQuery.data?.length ?? 0) >= MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY)
            return
        deleteMutation.reset()
        setFormAccount(null)
        setShowForm(true)
    }, [accountsQuery.data?.length, canUpdate, deleteMutation])

    const openEdit = useCallback(
        (account: BasicAuthAccount) => {
            if (!canUpdate) return
            deleteMutation.reset()
            setFormAccount(account)
            setShowForm(true)
        },
        [canUpdate, deleteMutation],
    )

    const setFormOpen = useCallback((nextOpen: boolean) => {
        setShowForm(nextOpen)
        if (!nextOpen) setFormAccount(null)
    }, [])

    const openDelete = useCallback(
        (account: BasicAuthAccount) => {
            if (!canUpdate) return
            setShowForm(false)
            setFormAccount(null)
            deleteMutation.reset()
            setDeleteTarget(account)
        },
        [canUpdate, deleteMutation],
    )

    const setDeleteOpen = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                deleteMutation.reset()
                setDeleteTarget(null)
            }
        },
        [deleteMutation],
    )

    const confirmDelete = useCallback(async () => {
        if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget).catch(() => undefined)
    }, [deleteMutation, deleteTarget])

    const handleFormSuccess = useCallback(async () => {
        setShowForm(false)
        setFormAccount(null)
        await invalidateAccounts()
    }, [invalidateAccounts])

    const retry = useCallback(() => {
        void accountsQuery.refetch()
    }, [accountsQuery])

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                setShowForm(false)
                setFormAccount(null)
                setDeleteTarget(null)
                deleteMutation.reset()
            }
            onOpenChange(nextOpen)
        },
        [deleteMutation, onOpenChange],
    )

    return {
        state: {
            accounts: accountsQuery.data ?? EMPTY_ACCOUNTS,
            deleteTarget,
            formAccount,
            isDeleting: deleteMutation.isPending,
            isError: accountsQuery.isError,
            isLoading: accountsQuery.isPending,
            isMutating: deleteMutation.isPending,
            showForm,
        },
        handler: {
            confirmDelete,
            handleFormSuccess,
            handleOpenChange,
            openCreate,
            openDelete,
            openEdit,
            retry,
            setDeleteOpen,
            setFormOpen,
        },
    }
}
