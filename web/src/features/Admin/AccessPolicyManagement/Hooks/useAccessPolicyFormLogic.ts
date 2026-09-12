import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import {
    ACCESS_POLICY_NAME_MAX_LENGTH,
    isAccessPolicyCombination,
    isAccessPolicyMode,
} from '../../../../config/access-policies.config'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import {
    accessPolicyIpRulesToDraft,
    parseAccessPolicyIpRulesDraft,
    type AccessPolicyIpRulesDraft,
} from '../Helpers/ipAccessPolicyState'
import { accessPolicyManagementQueryKeys } from '../queryKeys'
import { createAccessPolicyHandler, updateAccessPolicyHandler } from '../server'
import type {
    AccessPolicyFormModalProps,
    AccessPolicyFormSubmitValues,
    AccessPolicyFormValues,
} from '../Types/access-policy-form.types'

type ActionResult = {
    readonly success: boolean
    readonly message: string
    readonly runtimeStatus?: 'applied' | 'pending'
}

type FormErrors = {
    name?: string | undefined
    combination?: string | undefined
    ipRules?: string | undefined
}

function isIpRulesMode(mode: AccessPolicyFormValues['mode']): boolean {
    return mode === 'ip-restricted' || mode === 'combined'
}

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
        ipRules: accessPolicyIpRulesToDraft(policy?.ipRules),
    }))
    const [lastValidIpRules, setLastValidIpRules] = useState(() => policy?.ipRules ?? null)
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
        mutationFn: async (nextValues: AccessPolicyFormSubmitValues): Promise<ActionResult> => {
            const base = {
                name: nextValues.name,
                mode: nextValues.mode,
                combination: nextValues.combination,
            }
            const data =
                nextValues.ipRules === undefined
                    ? base
                    : {
                          ...base,
                          ipRules:
                              nextValues.ipRules === null
                                  ? null
                                  : {
                                        defaultAction: nextValues.ipRules.defaultAction,
                                        allow: [...nextValues.ipRules.allow],
                                        deny: [...nextValues.ipRules.deny],
                                    },
                      }
            if (mode === 'create') {
                return (await createAccessPolicyHandler({ data })) as ActionResult
            }
            if (!policy) throw new Error('admin.accessPolicies.errors.policyNotFound')
            return (await updateAccessPolicyHandler({
                data: { ...data, accessPolicyId: policy.id },
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

    const setIpRules = useCallback((ipRules: AccessPolicyIpRulesDraft | null) => {
        setValues((current) => ({ ...current, ipRules }))
        setErrors((current) => ({ ...current, ipRules: undefined }))
        const parsed = parseAccessPolicyIpRulesDraft(ipRules)
        if ('error' in parsed) return
        setLastValidIpRules(parsed.rules)
    }, [])

    const updateIpRulesDraft = useCallback(
        (update: (current: AccessPolicyIpRulesDraft) => AccessPolicyIpRulesDraft) => {
            if (!values.ipRules) return
            const nextIpRules = update(values.ipRules)
            const parsed = parseAccessPolicyIpRulesDraft(nextIpRules)
            setValues((current) => ({ ...current, ipRules: nextIpRules }))
            setErrors((current) => ({ ...current, ipRules: undefined }))
            if ('error' in parsed) return
            setLastValidIpRules(parsed.rules)
        },
        [values.ipRules],
    )

    const setIpRuleDefaultAction = useCallback(
        (value: string) => {
            if (value !== 'allow' && value !== 'deny') return
            updateIpRulesDraft((current) => ({ ...current, defaultAction: value }))
        },
        [updateIpRulesDraft],
    )

    const setIpRuleAllow = useCallback(
        (allow: string) => updateIpRulesDraft((current) => ({ ...current, allow })),
        [updateIpRulesDraft],
    )

    const setIpRuleDeny = useCallback(
        (deny: string) => updateIpRulesDraft((current) => ({ ...current, deny })),
        [updateIpRulesDraft],
    )

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
        if (isIpRulesMode(nextValues.mode) && nextValues.ipRules) {
            const parsed = parseAccessPolicyIpRulesDraft(nextValues.ipRules)
            if ('error' in parsed) nextErrors.ipRules = parsed.error
        }
        return nextErrors
    }, [])

    const submit = useCallback(async () => {
        const nextValues = { ...values, name: values.name.trim() }
        const nextErrors = validate(nextValues)
        const parsedIpRules = nextValues.ipRules
            ? parseAccessPolicyIpRulesDraft(nextValues.ipRules)
            : { rules: null }
        if (isIpRulesMode(nextValues.mode) && 'error' in parsedIpRules) {
            nextErrors.ipRules = parsedIpRules.error
        }
        setErrors(nextErrors)
        if (Object.keys(nextErrors).length > 0) return
        const submittedValues: AccessPolicyFormSubmitValues = {
            name: nextValues.name,
            mode: nextValues.mode,
            combination: nextValues.combination,
            ipRules: nextValues.ipRules
                ? isIpRulesMode(nextValues.mode)
                    ? parsedIpRules.rules
                    : lastValidIpRules
                : null,
        }
        mutation.reset()
        await mutation.mutateAsync(submittedValues).catch(() => undefined)
    }, [lastValidIpRules, mutation, validate, values])

    return {
        state: {
            errors,
            isPending: mutation.isPending,
            values,
        },
        handler: {
            setCombination,
            setIpRules,
            setIpRuleAllow,
            setIpRuleDefaultAction,
            setIpRuleDeny,
            setMode,
            setName,
            submit,
        },
    }
}
