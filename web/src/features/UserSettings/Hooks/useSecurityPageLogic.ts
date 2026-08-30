import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'

import useReauthenticationLogic from './useReauthenticationLogic'
import useSecurityLogic from './useSecurityLogic'

type DestructiveSecurityAction = 'disable' | 'regenerate' | 'remove'
type ReauthenticationAction = 'add' | 'enable' | 'rename' | DestructiveSecurityAction

type SecurityConfirmation =
    | { readonly kind: 'disable' }
    | { readonly kind: 'regenerate' }
    | { readonly kind: 'remove'; readonly passkeyId: string }

type PasskeyNameRequest =
    | { readonly kind: 'add' }
    | { readonly kind: 'rename'; readonly initialName?: string; readonly passkeyId: string }

export default function useSecurityPageLogic() {
    const security = useSecurityLogic()
    const reauthentication = useReauthenticationLogic()
    const [reauthAction, setReauthAction] = useState<ReauthenticationAction | null>(null)
    const [targetPasskeyId, setTargetPasskeyId] = useState<string | null>(null)
    const [pendingPasskeyName, setPendingPasskeyName] = useState<string | null>(null)
    const [nameRequest, setNameRequest] = useState<PasskeyNameRequest | null>(null)
    const [confirmation, setConfirmation] = useState<SecurityConfirmation | null>(null)
    const [confirmationError, setConfirmationError] = useState<string | null>(null)
    const [passkeyError, setPasskeyError] = useState<string | null>(null)
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
        setPasskeyError(null)
        setReauthAction(action)
        setTargetPasskeyId(passkeyId ?? null)
        setPendingPasskeyName(passkeyName ?? null)
    }

    async function registerPasskey(name: string): Promise<boolean> {
        setPasskeyError(null)
        try {
            const started = await security.handler.beginPasskey()
            if (!started.success || !started.options || !started.challengeId) {
                setPasskeyError(started.message)
                return false
            }
            const response = await startRegistration({ optionsJSON: started.options })
            const result = await security.handler.finishPasskey({
                challengeId: started.challengeId,
                name,
                response,
            })
            if (!result.success) {
                setPasskeyError(result.message)
                return false
            }
            return true
        } catch {
            setPasskeyError('account.passkeys.error.registrationFailed')
            return false
        }
    }

    async function beginTotpSetup() {
        setPasskeyError(null)
        try {
            const result = await security.handler.beginTotp()
            if (!result.success) {
                setPasskeyError(result.message)
            }
        } catch {
            setPasskeyError('account.twoFactor.error.setupStart')
        }
    }

    async function finishReauthentication() {
        const action = reauthAction
        const passkeyId = targetPasskeyId
        const passkeyName = pendingPasskeyName
        if (!action) return

        if (action === 'disable' || action === 'regenerate') {
            setConfirmation({ kind: action })
            setConfirmationError(null)
            resetReauthentication()
            return
        }
        if (action === 'remove' && passkeyId) {
            setConfirmation({ kind: 'remove', passkeyId })
            setConfirmationError(null)
            resetReauthentication()
            return
        }
        if (action === 'enable') {
            await beginTotpSetup()
            resetReauthentication()
            return
        }
        if (action === 'add') {
            if (passkeyName) await registerPasskey(passkeyName)
            else setNameRequest({ kind: 'add' })
            resetReauthentication()
            return
        }
        if (action === 'rename' && passkeyId && passkeyName) {
            const result = await security.handler.rename({ name: passkeyName, passkeyId })
            resetReauthentication()
            if (!result.success) {
                setNameRequest({
                    kind: 'rename',
                    initialName: passkeyName,
                    passkeyId,
                })
            }
        }
    }

    async function confirmReauthentication() {
        setPasskeyError(null)
        try {
            const result = await reauthentication.handler.verifyPassword()
            if (result.success) await finishReauthentication()
        } catch {
            setPasskeyError('account.reauthentication.error.failed')
        }
    }

    async function reauthenticateWithPasskey() {
        setPasskeyError(null)
        try {
            const started = await reauthentication.handler.beginPasskey()
            if (!started.success || !started.challengeId || !started.options) {
                setPasskeyError(started.message)
                return
            }
            const response = await startAuthentication({ optionsJSON: started.options })
            const result = await reauthentication.handler.finishPasskey({
                challengeId: started.challengeId,
                response,
            })
            if (result.success) await finishReauthentication()
            else setPasskeyError(result.message)
        } catch {
            setPasskeyError('account.reauthentication.error.passkeyVerification')
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
        setPasskeyError(null)
        if (recentlyAuthenticated) {
            if (action === 'remove' && passkeyId) setConfirmation({ kind: action, passkeyId })
            else if (action !== 'remove') setConfirmation({ kind: action })
            setConfirmationError(null)
            return
        }
        startReauthentication(action, passkeyId)
    }

    function requestRename(passkeyId: string) {
        setPasskeyError(null)
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
                    : (
                          await security.handler.rename({
                              name,
                              passkeyId: request.passkeyId,
                          })
                      ).success
        } catch {
            setPasskeyError(
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
                setConfirmation(null)
                setConfirmationError(null)
            } else {
                setConfirmationError(result.message)
            }
        } catch {
            setConfirmationError('account.security.error.change')
        }
    }

    return {
        state: {
            ...security.state,
            confirmation,
            confirmationError,
            nameRequest,
            passkeyError,
            reauthAction,
            reauthentication,
        },
        handler: {
            ...security.handler,
            closeConfirmation: () => {
                setConfirmation(null)
                setConfirmationError(null)
            },
            closePasskeyName: () => setNameRequest(null),
            closeReauthentication: resetReauthentication,
            confirmDestructiveAction,
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
