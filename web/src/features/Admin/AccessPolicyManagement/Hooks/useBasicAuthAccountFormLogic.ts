import { useMutation } from '@tanstack/react-query'
import { useCallback, useId, useState } from 'react'

import useToast from '../../../../shared/Toast/Hooks/useToast'
import { createBasicAuthAccountHandler, updateBasicAuthAccountHandler } from '../server'
import { validateBasicAuthAccount } from '../Helpers/basicAuthValidation'
import type {
    BasicAuthAccountFormErrors,
    BasicAuthAccountFormModalProps,
    BasicAuthAccountFormValues,
} from '../Types/basic-auth.types'

export default function useBasicAuthAccountFormLogic({
    accessPolicyId,
    account,
    mode,
    onOpenChange,
    onSuccess,
}: BasicAuthAccountFormModalProps) {
    const toast = useToast()
    const formId = useId()
    const [values, setValues] = useState<BasicAuthAccountFormValues>(() => ({
        username: account?.username ?? '',
        password: '',
    }))
    const [errors, setErrors] = useState<BasicAuthAccountFormErrors>({})

    const clearForm = useCallback(() => {
        setValues({ username: account?.username ?? '', password: '' })
        setErrors({})
    }, [account?.username])

    const mutation = useMutation({
        gcTime: 0,
        mutationFn: async (nextValues: BasicAuthAccountFormValues) => {
            if (mode === 'create') {
                return createBasicAuthAccountHandler({
                    data: {
                        accessPolicyId,
                        password: nextValues.password,
                        username: nextValues.username,
                    },
                })
            }

            if (!account) throw new Error('admin.accessPolicies.basicAuth.errors.accountNotFound')

            const data = {
                accessPolicyId,
                accountId: account.id,
                username: nextValues.username,
                ...(nextValues.password.length > 0 ? { password: nextValues.password } : {}),
            }
            return updateBasicAuthAccountHandler({ data })
        },
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }

            clearForm()
            if (result.runtimeStatus === 'pending') {
                toast.warning('admin.accessPolicies.basicAuth.messages.savedPending')
            } else {
                toast.success(result.message)
            }
            mutation.reset()
            await onSuccess()
        },
        onError: () => toast.error('admin.accessPolicies.basicAuth.errors.saveFailed'),
    })

    const setUsername = useCallback((username: string) => {
        setValues((current) => ({ ...current, username }))
        setErrors((current) => ({ ...current, username: undefined }))
    }, [])

    const setPassword = useCallback((password: string) => {
        setValues((current) => ({ ...current, password }))
        setErrors((current) => ({ ...current, password: undefined }))
    }, [])

    const submit = useCallback(async () => {
        if (mutation.isPending) return
        const nextErrors = validateBasicAuthAccount(values, mode)
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length > 0) return
        mutation.reset()
        await mutation.mutateAsync(values).catch(() => undefined)
    }, [mode, mutation, values])

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) {
                clearForm()
                onOpenChange(false)
            } else {
                onOpenChange(true)
            }
        },
        [clearForm, onOpenChange],
    )

    return {
        state: {
            errors,
            formId,
            isPending: mutation.isPending,
            values,
        },
        handler: {
            handleOpenChange,
            setPassword,
            setUsername,
            submit,
        },
    }
}
