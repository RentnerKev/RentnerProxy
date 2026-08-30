import useTranslationStore from '../../../language/useTranslationStore'
import FormMessage from '../../../shared/Forms/FormMessage'
import { ConfirmDialog } from '../../../shared/Modal/Components/ConfirmDialog'
import ReauthenticationModal from './ReauthenticationModal'
import RecoveryCodesModal from './RecoveryCodesModal'
import RenamePasskeyModal from './RenamePasskeyModal'
import SecuritySection from './SecuritySection'
import TotpSetupModal from './TotpSetupModal'
import useSecurityPageLogic from '../Hooks/useSecurityPageLogic'

export default function SecuritySettingsPanel() {
    const { t } = useTranslationStore()
    const security = useSecurityPageLogic()
    const { state, handler } = security
    const queryErrorMessage = state.error ? 'account.security.error.unavailable' : null
    const resultMessage =
        state.passkeyError ?? queryErrorMessage ?? state.lastResult?.message ?? null
    const resultTone =
        state.passkeyError || queryErrorMessage || (state.lastResult && !state.lastResult.success)
            ? 'error'
            : 'success'
    const confirmedPasskeyId =
        state.confirmation?.kind === 'remove' ? state.confirmation.passkeyId : null
    const confirmedPasskeyName = confirmedPasskeyId
        ? (state.status?.passkeys.find((passkey) => passkey.id === confirmedPasskeyId)?.name ??
          t('account.passkeys.defaultName'))
        : null
    const confirmationTitle =
        state.confirmation?.kind === 'remove'
            ? t('account.confirmation.removePasskeyTitle')
            : state.confirmation?.kind === 'disable'
              ? t('account.confirmation.disableTwoFactorTitle')
              : t('account.confirmation.regenerateRecoveryCodesTitle')
    const confirmationDescription =
        state.confirmation?.kind === 'remove'
            ? t('account.confirmation.removePasskeyDescription', { name: confirmedPasskeyName })
            : state.confirmation?.kind === 'disable'
              ? t('account.confirmation.disableTwoFactorDescription')
              : t('account.confirmation.regenerateRecoveryCodesDescription')
    const confirmationLabel =
        state.confirmation?.kind === 'remove'
            ? t('account.confirmation.removePasskey')
            : state.confirmation?.kind === 'disable'
              ? t('account.confirmation.disableTwoFactor')
              : t('account.confirmation.regenerateRecoveryCodes')

    return (
        <>
            {resultMessage ? <FormMessage tone={resultTone}>{resultMessage}</FormMessage> : null}
            <SecuritySection
                status={state.status}
                isLoading={state.isLoading}
                isPending={state.isPending}
                onEnableTotp={handler.requestEnableTotp}
                onAddPasskey={handler.requestAddPasskey}
                onDisableTotp={() => handler.requestDestructiveAction('disable')}
                onRegenerateCodes={() => handler.requestDestructiveAction('regenerate')}
                onRenamePasskey={handler.requestRename}
                onRemovePasskey={(passkeyId) =>
                    handler.requestDestructiveAction('remove', passkeyId)
                }
            />
            <TotpSetupModal
                key={state.setup?.challengeId ?? 'closed'}
                setup={state.setup}
                isPending={state.isPending}
                errorMessage={
                    state.lastResult && !state.lastResult.success
                        ? (state.lastResult.message ?? null)
                        : null
                }
                onConfirm={handler.confirmTotp}
                onClose={handler.resetSetup}
            />
            <RecoveryCodesModal
                key={state.recoveryCodes?.join(':') ?? 'closed'}
                codes={state.recoveryCodes}
                onClose={handler.resetRecoveryCodes}
            />
            <RenamePasskeyModal
                key={
                    state.nameRequest?.kind === 'rename'
                        ? state.nameRequest.passkeyId
                        : (state.nameRequest?.kind ?? 'closed')
                }
                open={state.nameRequest !== null}
                mode={state.nameRequest?.kind ?? 'add'}
                initialName={
                    state.nameRequest?.kind === 'rename' && state.nameRequest.initialName
                        ? state.nameRequest.initialName
                        : t('account.passkeys.defaultName')
                }
                isPending={state.isPending}
                errorMessage={
                    state.passkeyError ??
                    (state.lastResult && !state.lastResult.success
                        ? (state.lastResult.message ?? null)
                        : null)
                }
                onConfirm={handler.confirmPasskeyName}
                onClose={handler.closePasskeyName}
            />
            <ReauthenticationModal
                open={state.reauthAction !== null}
                isPending={state.reauthentication.state.isPending || state.isPending}
                value={state.reauthentication.state.credential}
                errorMessage={
                    state.reauthentication.state.result &&
                    !state.reauthentication.state.result.success
                        ? state.reauthentication.state.result.message
                        : state.passkeyError
                }
                onChange={state.reauthentication.handler.setCredential}
                onConfirm={handler.confirmReauthentication}
                onPasskey={handler.reauthenticateWithPasskey}
                onClose={handler.closeReauthentication}
            />
            <ConfirmDialog
                open={state.confirmation !== null}
                onOpenChange={(open) => {
                    if (!open) handler.closeConfirmation()
                }}
                title={confirmationTitle}
                description={confirmationDescription}
                confirmLabel={confirmationLabel}
                pendingLabel={t('account.confirmation.applying')}
                destructive
                isPending={state.isPending}
                errorMessage={state.confirmationError}
                onConfirm={handler.confirmDestructiveAction}
            />
        </>
    )
}
