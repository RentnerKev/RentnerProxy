import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { securityQueryKeys } from '../queryKeys'
import {
    beginPasskeyReauthenticationHandler,
    finishPasskeyReauthenticationHandler,
    reauthenticatePasswordHandler,
} from '../server'
import type { SerializedAuthenticationResponse } from '../Types/security.types'

export default function useReauthenticationLogic() {
    const queryClient = useQueryClient()
    const [credential, setCredential] = useState('')
    const refreshStatus = () =>
        queryClient.invalidateQueries({ queryKey: securityQueryKeys.status })
    const passwordMutation = useMutation({
        mutationFn: (value: string) =>
            reauthenticatePasswordHandler({ data: { credential: value } }),
        onSuccess: async (result) => {
            if (result.success) await refreshStatus()
        },
    })
    const passkeyBeginMutation = useMutation({
        mutationFn: () => beginPasskeyReauthenticationHandler({ data: {} }),
    })
    const passkeyFinishMutation = useMutation({
        mutationFn: (input: { challengeId: string; response: SerializedAuthenticationResponse }) =>
            finishPasskeyReauthenticationHandler({ data: input }),
        onSuccess: async (result) => {
            if (result.success) await refreshStatus()
        },
    })
    return {
        state: {
            credential,
            isPending:
                passwordMutation.isPending ||
                passkeyBeginMutation.isPending ||
                passkeyFinishMutation.isPending,
            result: passwordMutation.data ?? passkeyFinishMutation.data ?? null,
        },
        handler: {
            setCredential,
            reset: () => {
                setCredential('')
                passwordMutation.reset()
                passkeyBeginMutation.reset()
                passkeyFinishMutation.reset()
            },
            verifyPassword: () => passwordMutation.mutateAsync(credential),
            beginPasskey: () => passkeyBeginMutation.mutateAsync(),
            finishPasskey: (input: {
                challengeId: string
                response: SerializedAuthenticationResponse
            }) => passkeyFinishMutation.mutateAsync(input),
        },
    }
}
