import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import {
    ACCESS_POLICY_NAME_MAX_LENGTH,
    isAccessPolicyCombination,
    isAccessPolicyMode,
} from '../../../../config/access-policies.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import { accessPolicyManagementQueryKeys } from '../queryKeys'
import { createAccessPolicyHandler, updateAccessPolicyHandler } from '../server'
import type {
    AccessPolicyFormModalProps,
    AccessPolicyFormValues,
} from '../Types/access-policy-form.types'

type ActionResult = {
    readonly success: boolean
    readonly message: string
    readonly runtimeStatus?: 'applied' | 'pending'
}

type FormErrors = { name?: string | undefined; combination?: string | undefined }

export default function useAccessPolicyFormLogic({
    mode,
    onSuccess,
    policy,
}: Pick<AccessPolicyFormModalProps, 'mode' | 'onSuccess' | 'policy'>) {
    const toast = useToast()
    const queryClient = useQueryClient()
    const [values, setValues] = useState<AccessPolicyFormValues>(() => ({
        name: policy?.name ?? '',
        mode: policy?.mode ?? 'public',
        combination: policy?.combination ?? null,
    }))
    const [errors, setErrors] = useState<FormErrors>({})

    const invalidate = useCallback(async () => {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: accessPolicyManagementQueryKeys.all,
                exact: true,
            }),
            queryClient.invalidateQueries({
                queryKey: accessPolicyManagementQueryKeys.assignable,
            }),
            queryClient.invalidateQueries({
                queryKey: accessPolicyManagementQueryKeys.runtimeStatus,
            }),
        ])
    }, [queryClient])

    const mutation = useMutation({
        mutationFn: async (nextValues: AccessPolicyFormValues): Promise<ActionResult> => {
            if (mode === 'create') {
                return (await createAccessPolicyHandler({ data: nextValues })) as ActionResult
            }
            if (!policy) throw new Error('admin.accessPolicies.errors.policyNotFound')
            return (await updateAccessPolicyHandler({
                data: { ...nextValues, accessPolicyId: policy.id },
            })) as ActionResult
        },
        onSuccess: async (result) => {
            if (!result.success) {
                toast.error(result.message)
                return
            }
            await invalidate()
            if (result.runtimeStatus === 'pending') {
                toast.warning('admin.accessPolicies.runtime.savedPending')
            } else {
                toast.success(result.message)
            }
            onSuccess()
        },
        onError: () => toast.error('admin.accessPolicies.errors.saveFailed'),
    })

    const setName = useCallback((name: string) => {
        setValues((current) => ({ ...current, name }))
        setErrors((current) => ({ ...current, name: undefined }))
    }, [])

    const setMode = useCallback((value: string) => {
        if (!isAccessPolicyMode(value)) return
        setValues((current) => ({
            ...current,
            mode: value,
            combination: value === 'combined' ? (current.combination ?? 'all') : null,
        }))
        setErrors((current) => ({ ...current, combination: undefined }))
    }, [])

    const setCombination = useCallback((value: string) => {
        if (!isAccessPolicyCombination(value)) return
        setValues((current) => ({ ...current, combination: value }))
        setErrors((current) => ({ ...current, combination: undefined }))
    }, [])

    const validate = useCallback((nextValues: AccessPolicyFormValues): FormErrors => {
        const nextErrors: FormErrors = {}
        const name = nextValues.name.trim()
        if (!name) nextErrors.name = 'admin.accessPolicies.validation.nameRequired'
        else if (name.length > ACCESS_POLICY_NAME_MAX_LENGTH) {
            nextErrors.name = 'admin.accessPolicies.validation.nameTooLong'
        }
        if (nextValues.mode === 'combined' && nextValues.combination === null) {
            nextErrors.combination = 'admin.accessPolicies.validation.combinationRequired'
        }
        return nextErrors
    }, [])

    const submit = useCallback(async () => {
        const nextValues = { ...values, name: values.name.trim() }
        const nextErrors = validate(nextValues)
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length > 0) return
        mutation.reset()
        await mutation.mutateAsync(nextValues).catch(() => undefined)
    }, [mutation, validate, values])

    return {
        state: {
            errors,
            isPending: mutation.isPending,
            values,
        },
        handler: { setCombination, setMode, setName, submit },
    }
}
