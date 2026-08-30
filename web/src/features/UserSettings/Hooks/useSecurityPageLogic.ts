import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'

import useToast from '../../../shared/Toast/Hooks/useToast'
import useReauthenticationLogic from './useReauthenticationLogic'
import useSecurityLogic from './useSecurityLogic'

type DestructiveSecurityAction = 'disable' | 'regenerate' | 'remove'
type ReauthenticationAction = 'add' | 'enable' | 'rename' | DestructiveSecurityAction

type SecurityConfirmation =
    | { readonly kind: 'disable' }
    | { readonly kind: 'regenerate' }
    | { readonly kind: 'remove'; readonly passkeyId: string }

type PasskeyNameRequest =
    | { readonly kind: 'add'; readonly initialName?: string }
    | { readonly kind: 'rename'; readonly initialName?: string; readonly passkeyId: string }

export default function useSecurityPageLogic() {
    const toast = useToast()
    const security = useSecurityLogic()
    const reauthentication = useReauthenticationLogic()
    const [reauthAction, setReauthAction] = useState<ReauthenticationAction | null>(null)
    const [targetPasskeyId, setTargetPasskeyId] = useState<string | null>(null)
    const [pendingPasskeyName, setPendingPasskeyName] = useState<string | null>(null)
    const [nameRequest, setNameRequest] = useState<PasskeyNameRequest | null>(null)
    const [confirmation, setConfirmation] = useState<SecurityConfirmation | null>(null)
    const recentlyAuthenticated = security.state.status?.recentlyAuthenticated ?? false

    function resetReauthentication() {
        setReauthAction(null)
        setTargetPasskeyId(null)
        setPendingPasskeyName(null)
        reauthentication.handler.reset()
    }

    function startReauthentication(
        action: ReauthenticationAction,
        passkeyId?: string,
        passkeyName?: string,
    ) {
        setReauthAction(action)
        setTargetPasskeyId(passkeyId ?? null)
        setPendingPasskeyName(passkeyName ?? null)
    }

    async function registerPasskey(name: string): Promise<boolean> {
        try {
            const started = await security.handler.beginPasskey()
            if (!started.success || !started.options || !started.challengeId) {
                toast.error(started.message)
                return false
            }
            const response = await startRegistration({ optionsJSON: started.options })
            const result = await security.handler.finishPasskey({
                challengeId: started.challengeId,
                name,
                response,
            })
            if (!result.success) {
                toast.error(result.message)
                return false
            }
            toast.success(result.message)
            return true
        } catch {
            toast.error('account.passkeys.error.registrationFailed')
            return false
        }
    }

    async function renamePasskey(name: string, passkeyId: string): Promise<boolean> {
        try {
            const result = await security.handler.rename({ name, passkeyId })
            toast.show(result.message, result.success ? 'success' : 'error')
            return result.success
        } catch {
            toast.error('account.passkeys.error.rename')
            return false
        }
    }

    async function confirmTotp(code: string) {
        try {
            const result = await security.handler.confirmTotp(code)
            toast.show(result.message, result.success ? 'success' : 'error')
            return result
        } catch {
            toast.error('account.twoFactor.error.verify')
        }
    }

    async function beginTotpSetup() {
        try {
            const result = await security.handler.beginTotp()
            if (!result.success) {
                toast.error(result.message)
            }
        } catch {
            toast.error('account.twoFactor.error.setupStart')
        }
    }

    async function finishReauthentication() {
        const action = reauthAction
        const passkeyId = targetPasskeyId
        const passkeyName = pendingPasskeyName
        if (!action) return

        if (action === 'disable' || action === 'regenerate') {
            setConfirmation({ kind: action })
            resetReauthentication()
            return
        }
        if (action === 'remove' && passkeyId) {
            setConfirmation({ kind: 'remove', passkeyId })
            resetReauthentication()
            return
        }
        if (action === 'enable') {
            await beginTotpSetup()
            resetReauthentication()
            return
        }
        if (action === 'add') {
            const success = passkeyName ? await registerPasskey(passkeyName) : false
            resetReauthentication()
            if (!success) {
                setNameRequest(
                    passkeyName ? { kind: 'add', initialName: passkeyName } : { kind: 'add' },
                )
            }
            return
        }
        if (action === 'rename' && passkeyId && passkeyName) {
            const success = await renamePasskey(passkeyName, passkeyId)
            resetReauthentication()
            if (!success) {
                setNameRequest({
                    kind: 'rename',
                    initialName: passkeyName,
                    passkeyId,
                })
            }
        }
    }

    async function confirmReauthentication() {
        try {
            const result = await reauthentication.handler.verifyPassword()
            if (result.success) await finishReauthentication()
            else toast.error(result.message)
        } catch {
            toast.error('account.reauthentication.error.failed')
        }
    }

    async function reauthenticateWithPasskey() {
        try {
            const started = await reauthentication.handler.beginPasskey()
            if (!started.success || !started.challengeId || !started.options) {
                toast.error(started.message)
                return
            }
            const response = await startAuthentication({ optionsJSON: started.options })
            const result = await reauthentication.handler.finishPasskey({
                challengeId: started.challengeId,
                response,
            })
            if (result.success) await finishReauthentication()
            else toast.error(result.message)
        } catch {
            toast.error('account.reauthentication.error.passkeyVerification')
        }
    }

    function requestEnableTotp() {
        if (recentlyAuthenticated) void beginTotpSetup()
        else startReauthentication('enable')
    }

    function requestAddPasskey() {
        if (recentlyAuthenticated) {
            setNameRequest({ kind: 'add' })
        } else startReauthentication('add')
    }

    function requestDestructiveAction(action: DestructiveSecurityAction, passkeyId?: string) {
        if (recentlyAuthenticated) {
            if (action === 'remove' && passkeyId) setConfirmation({ kind: action, passkeyId })
            else if (action !== 'remove') setConfirmation({ kind: action })
            return
        }
        startReauthentication(action, passkeyId)
    }

    function requestRename(passkeyId: string) {
        const passkey = security.state.status?.passkeys.find((entry) => entry.id === passkeyId)
        setNameRequest(
            passkey?.name
                ? { kind: 'rename', initialName: passkey.name, passkeyId }
                : { kind: 'rename', passkeyId },
        )
    }

    async function confirmPasskeyName(name: string) {
        const request = nameRequest
        if (!request) return

        if (!recentlyAuthenticated) {
            setNameRequest(null)
            startReauthentication(
                request.kind,
                request.kind === 'rename' ? request.passkeyId : undefined,
                name,
            )
            return
        }

        let success = false
        try {
            success =
                request.kind === 'add'
                    ? await registerPasskey(name)
                    : await renamePasskey(name, request.passkeyId)
        } catch {
            toast.error(
                request.kind === 'add'
                    ? 'account.passkeys.error.registrationFailed'
                    : 'account.passkeys.error.rename',
            )
        }
        if (success) setNameRequest(null)
    }

    async function confirmDestructiveAction() {
        const request = confirmation
        if (!request) return
        try {
            let result
            if (request.kind === 'disable') {
                result = await security.handler.disableTotp()
            } else if (request.kind === 'regenerate') {
                result = await security.handler.regenerate()
            } else {
                result = await security.handler.remove({ passkeyId: request.passkeyId })
            }
            if (result.success) {
                toast.success(result.message)
                setConfirmation(null)
            } else {
                toast.error(result.message)
            }
        } catch {
            toast.error('account.security.error.change')
        }
    }

    return {
        state: {
            ...security.state,
            confirmation,
            nameRequest,
            reauthAction,
            reauthentication,
        },
        handler: {
            ...security.handler,
            closeConfirmation: () => {
                setConfirmation(null)
            },
            closePasskeyName: () => setNameRequest(null),
            closeReauthentication: resetReauthentication,
            confirmDestructiveAction,
            confirmTotp,
            confirmPasskeyName,
            confirmReauthentication,
            reauthenticateWithPasskey,
            requestAddPasskey,
            requestDestructiveAction,
            requestEnableTotp,
            requestRename,
        },
    }
}
