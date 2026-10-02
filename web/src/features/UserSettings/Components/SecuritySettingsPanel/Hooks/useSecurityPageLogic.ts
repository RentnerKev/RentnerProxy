import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'

import { toast } from '@rentnerkev/toasts/toast'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { getPasskeyRegistrationErrorKey } from '@/lib/UserSettings/security.ts'
import useReauthentication from './useReauthentication.ts'
import useSecurityOperations from './useSecurityOperations.ts'

import type {
    DestructiveSecurityAction,
    ReauthenticationAction,
    SecurityConfirmation,
    PasskeyNameRequest,
    SecurityPageLogicResult,
} from '../Types/security-page.types.ts'

export default function useSecurityPageLogic() {
    const { t } = useTranslationStore()
    const security = useSecurityOperations()
    const reauthentication = useReauthentication()
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
                toast.error(t(started.message), { title: t('toast.titles.error') })
                return false
            }
            const response = await startRegistration({ optionsJSON: started.options })
            const result = await security.handler.finishPasskey({
                challengeId: started.challengeId,
                name,
                response,
            })
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
                return false
            }
            toast.success(t(result.message), { title: t('toast.titles.success') })
            return true
        } catch (error) {
            toast.error(t(getPasskeyRegistrationErrorKey(error)), {
                title: t('toast.titles.error'),
            })
            return false
        }
    }

    async function renamePasskey(name: string, passkeyId: string): Promise<boolean> {
        try {
            const result = await security.handler.rename({ name, passkeyId })
            toast[result.success ? 'success' : 'error'](t(result.message), {
                title: t('toast.titles.' + (result.success ? 'success' : 'error')),
            })
            return result.success
        } catch {
            toast.error(t('account.passkeys.error.rename'), { title: t('toast.titles.error') })
            return false
        }
    }

    async function confirmTotp(code: string) {
        try {
            const result = await security.handler.confirmTotp(code)
            toast[result.success ? 'success' : 'error'](t(result.message), {
                title: t('toast.titles.' + (result.success ? 'success' : 'error')),
            })
            return result
        } catch {
            toast.error(t('account.twoFactor.error.verify'), { title: t('toast.titles.error') })
        }
    }

    async function beginTotpSetup() {
        try {
            const result = await security.handler.beginTotp()
            if (!result.success) {
                toast.error(t(result.message), { title: t('toast.titles.error') })
            }
        } catch {
            toast.error(t('account.twoFactor.error.setupStart'), { title: t('toast.titles.error') })
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
            else toast.error(t(result.message), { title: t('toast.titles.error') })
        } catch {
            toast.error(t('account.reauthentication.error.failed'), {
                title: t('toast.titles.error'),
            })
        }
    }

    async function reauthenticateWithPasskey() {
        try {
            const started = await reauthentication.handler.beginPasskey()
            if (!started.success || !started.challengeId || !started.options) {
                toast.error(t(started.message), { title: t('toast.titles.error') })
                return
            }
            const response = await startAuthentication({ optionsJSON: started.options })
            const result = await reauthentication.handler.finishPasskey({
                challengeId: started.challengeId,
                response,
            })
            if (result.success) await finishReauthentication()
            else toast.error(t(result.message), { title: t('toast.titles.error') })
        } catch {
            toast.error(t('account.reauthentication.error.passkeyVerification'), {
                title: t('toast.titles.error'),
            })
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
                t(
                    request.kind === 'add'
                        ? 'account.passkeys.error.registrationFailed'
                        : 'account.passkeys.error.rename',
                ),
                { title: t('toast.titles.error') },
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
                toast.success(t(result.message), { title: t('toast.titles.success') })
                setConfirmation(null)
            } else {
                toast.error(t(result.message), { title: t('toast.titles.error') })
            }
        } catch {
            toast.error(t('account.security.error.change'), { title: t('toast.titles.error') })
        }
    }

    const confirmedPasskeyId = confirmation?.kind === 'remove' ? confirmation.passkeyId : null
    const confirmedPasskeyName = confirmedPasskeyId
        ? (security.state.status?.passkeys.find((passkey) => passkey.id === confirmedPasskeyId)
              ?.name ?? t('account.passkeys.defaultName'))
        : null
    const confirmationTitle =
        confirmation?.kind === 'remove'
            ? t('account.confirmation.removePasskeyTitle')
            : confirmation?.kind === 'disable'
              ? t('account.confirmation.disableTwoFactorTitle')
              : t('account.confirmation.regenerateRecoveryCodesTitle')
    const confirmationDescription =
        confirmation?.kind === 'remove'
            ? t('account.confirmation.removePasskeyDescription', { name: confirmedPasskeyName })
            : confirmation?.kind === 'disable'
              ? t('account.confirmation.disableTwoFactorDescription')
              : t('account.confirmation.regenerateRecoveryCodesDescription')
    const confirmationLabel =
        confirmation?.kind === 'remove'
            ? t('account.confirmation.removePasskey')
            : confirmation?.kind === 'disable'
              ? t('account.confirmation.disableTwoFactor')
              : t('account.confirmation.regenerateRecoveryCodes')

    return {
        state: {
            status: security.state.status,
            setup: security.state.setup,
            recoveryCodes: security.state.recoveryCodes,
            isLoading: security.state.isLoading,
            error: security.state.error,
            isPending: security.state.isPending,
            reauthenticationCredential: reauthentication.state.credential,
            isReauthenticationPending: reauthentication.state.isPending,
            confirmationTitle,
            confirmationDescription,
            confirmationLabel,
            confirmation,
            nameRequest,
            reauthAction,
        },
        setter: { setReauthenticationCredential: reauthentication.setter.setCredential },
        handler: {
            handleConfirmationOpenChange: (open) => {
                if (!open) setConfirmation(null)
            },
            handleReauthenticationOpenChange: (open) => {
                if (!open && !reauthentication.state.isPending) resetReauthentication()
            },
            resetSetup: security.handler.resetSetup,
            resetRecoveryCodes: security.handler.resetRecoveryCodes,
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
    } satisfies SecurityPageLogicResult
}
