import type { ReauthenticationResult } from '../Types/reauthentication.types.ts'
import { invalidateSecurityStatusCache } from '@/lib/UserSettings/userSettingsCache.ts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
    beginPasskeyReauthenticationHandler,
    finishPasskeyReauthenticationHandler,
    reauthenticatePasswordHandler,
} from '../../../middleware.ts'
import type { SerializedAuthenticationResponse } from '../../../Types/security.types.ts'

export default function useReauthentication() {
    const queryClient = useQueryClient()
    const [credential, setCredential] = useState('')
    const refreshStatus = () => invalidateSecurityStatusCache(queryClient)
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
        },
        setter: { setCredential },
        handler: {
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
    } satisfies ReauthenticationResult
}
