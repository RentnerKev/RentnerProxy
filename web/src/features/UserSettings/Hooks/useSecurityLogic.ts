import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { securityQueryKeys } from '../queryKeys'
import {
    beginPasskeyRegistrationHandler,
    beginTotpSetupHandler,
    confirmTotpSetupHandler,
    disableTotpHandler,
    finishPasskeyRegistrationHandler,
    getSecurityStatusHandler,
    regenerateRecoveryCodesHandler,
    removePasskeyHandler,
    renamePasskeyHandler,
} from '../server'
import type { SecurityActionResult, SerializedRegistrationResponse } from '../Types/security.types'

export default function useSecurityLogic() {
    const queryClient = useQueryClient()
    const statusQuery = useQuery({
        queryKey: securityQueryKeys.status,
        queryFn: getSecurityStatusHandler,
    })
    const [setup, setSetup] = useState<{
        challengeId: string
        secret: string
        otpAuthUrl: string
    } | null>(null)
    const [recoveryCodes, setRecoveryCodes] = useState<ReadonlyArray<string> | null>(null)
    const [lastResult, setLastResult] = useState<SecurityActionResult | null>(null)
    const refresh = () => queryClient.invalidateQueries({ queryKey: securityQueryKeys.status })
    const resetResult = () => setLastResult(null)
    const recordResult = (result: SecurityActionResult) => setLastResult(result)
    const beginTotp = useMutation({
        mutationFn: () => beginTotpSetupHandler({ data: {} }),
        onMutate: resetResult,
        onSuccess: (result) => {
            recordResult(result)
            if (result.success && result.challengeId && result.secret && result.otpAuthUrl)
                setSetup({
                    challengeId: result.challengeId,
                    secret: result.secret,
                    otpAuthUrl: result.otpAuthUrl,
                })
        },
    })
    const confirmTotp = useMutation({
        mutationFn: (code: string) => {
            if (!setup) throw new Error('account.twoFactor.error.setupUnavailable')
            return confirmTotpSetupHandler({ data: { challengeId: setup.challengeId, code } })
        },
        onMutate: resetResult,
        onSuccess: async (result) => {
            recordResult(result)
            if (result.success) {
                if (result.recoveryCodes) setRecoveryCodes(result.recoveryCodes)
                setSetup(null)
                await refresh()
            }
        },
    })
    const disableTotp = useMutation({
        mutationFn: () => disableTotpHandler({ data: {} }),
        onMutate: resetResult,
        onSuccess: async (result) => {
            recordResult(result)
            if (result.success) await refresh()
        },
    })
    const regenerate = useMutation({
        mutationFn: () => regenerateRecoveryCodesHandler({ data: {} }),
        onMutate: resetResult,
        onSuccess: async (result) => {
            recordResult(result)
            if (result.success) {
                setRecoveryCodes(result.recoveryCodes ?? [])
                await refresh()
            }
        },
    })
    const beginPasskey = useMutation({
        mutationFn: () => beginPasskeyRegistrationHandler({ data: {} }),
        onMutate: resetResult,
        onSuccess: recordResult,
    })
    const finishPasskey = useMutation({
        mutationFn: (input: {
            challengeId: string
            name: string
            response: SerializedRegistrationResponse
        }) => finishPasskeyRegistrationHandler({ data: input }),
        onMutate: resetResult,
        onSuccess: async (result) => {
            recordResult(result)
            if (result.success) await refresh()
        },
    })
    const rename = useMutation({
        mutationFn: (input: { passkeyId: string; name: string }) =>
            renamePasskeyHandler({ data: input }),
        onMutate: resetResult,
        onSuccess: async (result) => {
            recordResult(result)
            if (result.success) await refresh()
        },
    })
    const remove = useMutation({
        mutationFn: (input: { passkeyId: string }) => removePasskeyHandler({ data: input }),
        onMutate: resetResult,
        onSuccess: async (result) => {
            recordResult(result)
            if (result.success) await refresh()
        },
    })
    const resetSetup = () => {
        setSetup(null)
        resetResult()
        beginTotp.reset()
        confirmTotp.reset()
    }
    const resetRecoveryCodes = () => {
        setRecoveryCodes(null)
        regenerate.reset()
    }
    return {
        state: {
            status: statusQuery.data,
            setup,
            recoveryCodes,
            isLoading: statusQuery.isPending,
            error: statusQuery.error,
            isPending:
                beginTotp.isPending ||
                confirmTotp.isPending ||
                disableTotp.isPending ||
                regenerate.isPending ||
                beginPasskey.isPending ||
                finishPasskey.isPending ||
                rename.isPending ||
                remove.isPending,
            lastResult,
        },
        handler: {
            beginTotp: () => beginTotp.mutateAsync(),
            confirmTotp: (code: string) => confirmTotp.mutateAsync(code),
            resetSetup,
            resetRecoveryCodes,
            disableTotp: () => disableTotp.mutateAsync(),
            regenerate: () => regenerate.mutateAsync(),
            beginPasskey: () => beginPasskey.mutateAsync(),
            finishPasskey: (input: {
                challengeId: string
                name: string
                response: SerializedRegistrationResponse
            }) => finishPasskey.mutateAsync(input),
            rename: (input: { passkeyId: string; name: string }) => rename.mutateAsync(input),
            remove: (input: { passkeyId: string }) => remove.mutateAsync(input),
        },
    }
}
