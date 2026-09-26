import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import {
    ACCESS_POLICY_NAME_MAX_LENGTH,
    isAccessPolicyCombination,
    isAccessPolicyMode,
} from '../../../../config/access-policies.config'
import {
    DEFAULT_FORWARD_AUTH_TIMEOUT_SECONDS,
    FORWARD_AUTH_PROVIDERS,
    isAllowedForwardAuthResponseHeader,
    isCanonicalForwardAuthEndpoint,
    isValidForwardAuthGatewayPathPrefix,
    type ForwardAuthConfiguration,
} from '../../../../shared/Helpers/forwardAuth'
import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '../../../../language/useTranslationStore'
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
    forwardAuth?: string | undefined
}

const FORWARD_AUTH_HEADER_PRESETS: Record<
    (typeof FORWARD_AUTH_PROVIDERS)[number],
    ReadonlyArray<string>
> = {
    generic: [],
    authentik: ['X-Authentik-Username', 'X-Authentik-Email'],
    authelia: ['Remote-User', 'Remote-Email'],
    'oauth2-proxy': ['X-Auth-Request-User', 'X-Auth-Request-Email'],
}

const DEFAULT_FORWARD_AUTH: ForwardAuthConfiguration = {
    provider: 'generic',
    endpoint: '',
    timeoutSeconds: DEFAULT_FORWARD_AUTH_TIMEOUT_SECONDS,
    gatewayPathPrefix: null,
    requestHeaders: ['Cookie'],
    responseHeaders: [],
}

function toForwardAuthDraft(config: ForwardAuthConfiguration | null | undefined) {
    const value = config ?? DEFAULT_FORWARD_AUTH
    return {
        provider: value.provider,
        endpoint: value.endpoint,
        gatewayPathPrefix: value.gatewayPathPrefix ?? '',
        timeoutSeconds: String(value.timeoutSeconds),
        requestHeaders: [...value.requestHeaders],
        responseHeaders: value.responseHeaders.join('\n'),
    }
}

function parseForwardAuthResponseHeaders(value: string): string[] {
    return value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .toSorted((left, right) => {
            const a = left.toLowerCase()
            const b = right.toLowerCase()
            return a < b ? -1 : a > b ? 1 : 0
        })
}

function isIpRulesMode(mode: AccessPolicyFormValues['mode']): boolean {
    return mode === 'ip-restricted' || mode === 'combined'
}

export default function useAccessPolicyFormLogic({
    mode,
    onSuccess,
    policy,
}: Pick<AccessPolicyFormModalProps, 'mode' | 'onSuccess' | 'policy'>) {
    const { t } = useTranslationStore()
    const queryClient = useQueryClient()
    const [values, setValues] = useState<AccessPolicyFormValues>(() => ({
        name: policy?.name ?? '',
        mode: policy?.mode ?? 'public',
        combination: policy?.combination ?? null,
        ipRules: accessPolicyIpRulesToDraft(policy?.ipRules),
        authMethod: policy?.forwardAuth ? 'forwardAuth' : 'basicAuth',
        forwardAuth: toForwardAuthDraft(policy?.forwardAuth),
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
                forwardAuth: nextValues.forwardAuth,
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
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return
            }
            await invalidate()
            if (result.runtimeStatus === 'pending') {
                toast.warning(t('admin.accessPolicies.runtime.savedPending'), {
                    title: t('toast.titles.warning'),
                })
            } else {
                toast.success(t(result.message), { title: t('toast.titles.success') })
            }
            onSuccess()
        },
        onError: () =>
            toast.error(t('admin.accessPolicies.errors.saveFailed'), {
                title: t('toast.titles.error'),
            }),
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

    const setCombination = useCallback(
        (value: string) => {
            if (!isAccessPolicyCombination(value)) return
            if (value === 'any' && values.authMethod === 'forwardAuth') return
            setValues((current) => ({ ...current, combination: value }))
            setErrors((current) => ({ ...current, combination: undefined }))
        },
        [values.authMethod],
    )

    const setAuthMethod = useCallback((value: string) => {
        if (value !== 'basicAuth' && value !== 'forwardAuth') return
        setValues((current) => ({
            ...current,
            authMethod: value,
            combination:
                value === 'forwardAuth' && current.mode === 'combined'
                    ? 'all'
                    : current.combination,
        }))
        setErrors((current) => ({ ...current, combination: undefined, forwardAuth: undefined }))
    }, [])

    const setForwardAuthProvider = useCallback((value: string) => {
        if (!(FORWARD_AUTH_PROVIDERS as readonly string[]).includes(value)) return
        const provider = value as (typeof FORWARD_AUTH_PROVIDERS)[number]
        setValues((current) => ({
            ...current,
            forwardAuth: {
                ...current.forwardAuth,
                provider,
                gatewayPathPrefix: provider === 'authentik' ? '/outpost.goauthentik.io/' : '',
                responseHeaders: FORWARD_AUTH_HEADER_PRESETS[provider].join('\n'),
            },
        }))
        setErrors((current) => ({ ...current, forwardAuth: undefined }))
    }, [])

    const updateForwardAuth = useCallback(
        (
            update: (
                current: AccessPolicyFormValues['forwardAuth'],
            ) => AccessPolicyFormValues['forwardAuth'],
        ) => {
            setValues((current) => ({ ...current, forwardAuth: update(current.forwardAuth) }))
            setErrors((current) => ({ ...current, forwardAuth: undefined }))
        },
        [],
    )

    const setForwardAuthEndpoint = useCallback(
        (endpoint: string) => updateForwardAuth((current) => ({ ...current, endpoint })),
        [updateForwardAuth],
    )

    const setForwardAuthGatewayPathPrefix = useCallback(
        (gatewayPathPrefix: string) =>
            updateForwardAuth((current) => ({ ...current, gatewayPathPrefix })),
        [updateForwardAuth],
    )

    const setForwardAuthTimeout = useCallback(
        (timeoutSeconds: string) =>
            updateForwardAuth((current) => ({ ...current, timeoutSeconds })),
        [updateForwardAuth],
    )

    const setForwardAuthRequestHeader = useCallback(
        (value: 'Authorization' | 'Cookie', checked: boolean) =>
            updateForwardAuth((current) => ({
                ...current,
                requestHeaders: checked
                    ? [...new Set([...current.requestHeaders, value])].toSorted()
                    : current.requestHeaders.filter((header) => header !== value),
            })),
        [updateForwardAuth],
    )

    const setForwardAuthResponseHeaders = useCallback(
        (responseHeaders: string) =>
            updateForwardAuth((current) => ({ ...current, responseHeaders })),
        [updateForwardAuth],
    )

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
        if (
            (nextValues.mode === 'authenticated' || nextValues.mode === 'combined') &&
            nextValues.authMethod === 'forwardAuth'
        ) {
            const endpoint = nextValues.forwardAuth.endpoint
            const timeout = Number(nextValues.forwardAuth.timeoutSeconds)
            const responseHeaders = parseForwardAuthResponseHeaders(
                nextValues.forwardAuth.responseHeaders,
            )
            if (!isCanonicalForwardAuthEndpoint(endpoint)) {
                nextErrors.forwardAuth = 'admin.accessPolicies.validation.forwardAuthEndpoint'
            } else if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30) {
                nextErrors.forwardAuth = 'admin.accessPolicies.validation.forwardAuthTimeout'
            } else if (
                responseHeaders.length > 16 ||
                responseHeaders.some(
                    (header, index) =>
                        !isAllowedForwardAuthResponseHeader(header) ||
                        (index > 0 &&
                            header.toLowerCase() === responseHeaders[index - 1]?.toLowerCase()),
                )
            ) {
                nextErrors.forwardAuth = 'admin.accessPolicies.validation.forwardAuthHeaders'
            } else if (
                nextValues.forwardAuth.gatewayPathPrefix.trim() !== '' &&
                !isValidForwardAuthGatewayPathPrefix(nextValues.forwardAuth.gatewayPathPrefix)
            ) {
                nextErrors.forwardAuth = 'admin.accessPolicies.validation.forwardAuthGatewayPath'
            }
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
            forwardAuth:
                (nextValues.mode === 'authenticated' || nextValues.mode === 'combined') &&
                nextValues.authMethod === 'forwardAuth'
                    ? {
                          provider: nextValues.forwardAuth.provider,
                          endpoint: nextValues.forwardAuth.endpoint,
                          timeoutSeconds: Number(nextValues.forwardAuth.timeoutSeconds),
                          gatewayPathPrefix:
                              nextValues.forwardAuth.gatewayPathPrefix.trim() === ''
                                  ? null
                                  : nextValues.forwardAuth.gatewayPathPrefix,
                          requestHeaders: [...nextValues.forwardAuth.requestHeaders].toSorted(),
                          responseHeaders: parseForwardAuthResponseHeaders(
                              nextValues.forwardAuth.responseHeaders,
                          ),
                      }
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
            setAuthMethod,
            setForwardAuthProvider,
            setForwardAuthEndpoint,
            setForwardAuthGatewayPathPrefix,
            setForwardAuthTimeout,
            setForwardAuthRequestHeader,
            setForwardAuthResponseHeaders,
            submit,
        },
    }
}
