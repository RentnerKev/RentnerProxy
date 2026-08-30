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
            {state.error ? (
                <FormMessage tone="error">account.security.error.unavailable</FormMessage>
            ) : null}
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
                key={`totp-${state.setup?.challengeId ?? 'closed'}`}
                setup={state.setup}
                isPending={state.isPending}
                onConfirm={handler.confirmTotp}
                onClose={handler.resetSetup}
            />
            <RecoveryCodesModal
                key={`recovery-${state.recoveryCodes?.join(':') ?? 'closed'}`}
                codes={state.recoveryCodes}
                onClose={handler.resetRecoveryCodes}
            />
            <RenamePasskeyModal
                key={
                    state.nameRequest?.kind === 'rename'
                        ? `passkey-name-${state.nameRequest.passkeyId}`
                        : `passkey-name-${state.nameRequest?.kind ?? 'closed'}`
                }
                open={state.nameRequest !== null}
                mode={state.nameRequest?.kind ?? 'add'}
                initialName={state.nameRequest?.initialName ?? t('account.passkeys.defaultName')}
                isPending={state.isPending}
                onConfirm={handler.confirmPasskeyName}
                onClose={handler.closePasskeyName}
            />
            <ReauthenticationModal
                open={state.reauthAction !== null}
                isPending={state.reauthentication.state.isPending || state.isPending}
                value={state.reauthentication.state.credential}
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
                onConfirm={handler.confirmDestructiveAction}
            />
        </>
    )
}
