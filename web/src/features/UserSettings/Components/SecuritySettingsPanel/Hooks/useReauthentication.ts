import type { ReauthenticationResult } from '../Types/reauthentication.types.ts'
import { invalidateSecurityStatusCache } from '@/lib/UserSettings/userSettingsCache.ts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import {
    beginPasskeyReauthenticationHandler,
    finishPasskeyReauthenticationHandler,
    reauthenticatePasswordHandler,
} from '../../../middleware.ts'
import type { SerializedAuthenticationResponse } from '../../../Types/security.types.ts'

export default function useReauthentication() {
    const queryClient = useQueryClient()
    const [credential, setCredential] = useState('')
    const passkeyInput = useRef<{
        challengeId: string
        response: SerializedAuthenticationResponse
    } | null>(null)
    const refreshStatus = () => invalidateSecurityStatusCache(queryClient)
    const passwordMutation = useMutation({
        mutationFn: () => reauthenticatePasswordHandler({ data: { credential } }),
        retry: false,
        gcTime: 0,
        onSuccess: async (result) => {
            if (result.success) await refreshStatus()
        },
    })
    const passkeyBeginMutation = useMutation({
        mutationFn: () => beginPasskeyReauthenticationHandler({ data: {} }),
        retry: false,
        gcTime: 0,
    })
    const passkeyFinishMutation = useMutation({
        mutationFn: async () => {
            const input = passkeyInput.current
            if (!input) throw new Error('Passkey assertion unavailable')
            try {
                return await finishPasskeyReauthenticationHandler({ data: input })
            } finally {
                passkeyInput.current = null
            }
        },
        retry: false,
        gcTime: 0,
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
                passkeyInput.current = null
                passwordMutation.reset()
                passkeyBeginMutation.reset()
                passkeyFinishMutation.reset()
            },
            verifyPassword: () => passwordMutation.mutateAsync(),
            beginPasskey: () => passkeyBeginMutation.mutateAsync(),
            finishPasskey: (input: {
                challengeId: string
                response: SerializedAuthenticationResponse
            }) => {
                passkeyInput.current = input
                return passkeyFinishMutation.mutateAsync()
            },
        },
    } satisfies ReauthenticationResult
}
