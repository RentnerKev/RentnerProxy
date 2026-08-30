import FormMessage from '../../../shared/Forms/FormMessage'
import PageHeader from '../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import AccountIdentity from './Components/AccountIdentity'
import ChangePasswordPanel from './Components/ChangePasswordPanel'
import ProfileImagePanel from './Components/ProfileImagePanel'
import ReauthenticationModal from './Components/ReauthenticationModal'
import RecoveryCodesModal from './Components/RecoveryCodesModal'
import RenamePasskeyModal from './Components/RenamePasskeyModal'
import SecuritySection from './Components/SecuritySection'
import TotpSetupModal from './Components/TotpSetupModal'
import { getAccountPageViewModel } from './Helpers/accountPage'
import useSecurityPageLogic from './Hooks/useSecurityPageLogic'
import type { AccountPageProps } from './Types/account-component-props.types'

export default function AccountPage({ user }: AccountPageProps) {
    const viewModel = getAccountPageViewModel(user)
    const security = useSecurityPageLogic()
    const { state, handler } = security
    const queryErrorMessage = state.error instanceof Error ? state.error.message : null
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
          'This passkey')
        : null
    const confirmationTitle =
        state.confirmation?.kind === 'remove'
            ? 'Remove this passkey?'
            : state.confirmation?.kind === 'disable'
              ? 'Disable two-factor authentication?'
              : 'Regenerate recovery codes?'
    const confirmationDescription =
        state.confirmation?.kind === 'remove'
            ? `"${confirmedPasskeyName}" will no longer be available for signing in to your account.`
            : state.confirmation?.kind === 'disable'
              ? 'Password sign-ins will no longer require an authenticator code.'
              : 'Your existing recovery codes will stop working immediately.'
    const confirmationLabel =
        state.confirmation?.kind === 'remove'
            ? 'Remove passkey'
            : state.confirmation?.kind === 'disable'
              ? 'Disable 2FA'
              : 'Regenerate codes'

    return (
        <>
            <PageHeader
                eyebrow="Personal access"
                title="Account"
                description="Manage your profile picture, credentials, and security for this RentnerProxy account."
            />
            <div className={uiClassNames.management.grid}>
                <div className={uiClassNames.management.accountGrid}>
                    <div className="grid gap-4">
                        <AccountIdentity user={user} />
                        <ProfileImagePanel
                            canUpdateProfileImage={viewModel.canUpdateProfileImage}
                            user={user}
                        />
                    </div>
                    <ChangePasswordPanel />
                </div>
                {resultMessage ? (
                    <FormMessage tone={resultTone}>{resultMessage}</FormMessage>
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
            </div>
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
                initialName={state.nameRequest?.initialName ?? 'Passkey'}
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
                pendingLabel="Applying…"
                destructive
                isPending={state.isPending}
                errorMessage={state.confirmationError}
                onConfirm={handler.confirmDestructiveAction}
            />
        </>
    )
}
