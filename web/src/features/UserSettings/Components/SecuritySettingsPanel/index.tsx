import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FormMessage from '@/shared/Forms/FormMessage.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import ReauthenticationModal from './Components/ReauthenticationModal.tsx'
import RecoveryCodesModal from '../RecoveryCodesModal/index.tsx'
import RenamePasskeyModal from '../RenamePasskeyModal/index.tsx'
import PasskeysSection from './Components/PasskeysSection.tsx'
import TwoFactorSection from './Components/TwoFactorSection.tsx'
import TotpSetupModal from '../TotpSetupModal/index.tsx'
import useSecurityPageLogic from './Hooks/useSecurityPageLogic.ts'
import type { SecuritySettingsSection } from '../../Types/user-settings-section.types.ts'

export default function SecuritySettingsPanel({
    section,
}: {
    readonly section: SecuritySettingsSection
}) {
    const { t } = useTranslationStore()
    const security = useSecurityPageLogic()
    const { state, handler, setter } = security
    return (
        <>
            {state.error ? (
                <FormMessage tone="error">account.security.error.unavailable</FormMessage>
            ) : null}
            {section === 'two-factor' ? (
                <TwoFactorSection
                    status={state.status}
                    isLoading={state.isLoading}
                    isPending={state.isPending}
                    onEnableTotp={handler.requestEnableTotp}
                    onDisableTotp={() => handler.requestDestructiveAction('disable')}
                    onRegenerateCodes={() => handler.requestDestructiveAction('regenerate')}
                />
            ) : (
                <PasskeysSection
                    status={state.status}
                    isLoading={state.isLoading}
                    isPending={state.isPending}
                    onAddPasskey={handler.requestAddPasskey}
                    onRenamePasskey={handler.requestRename}
                    onRemovePasskey={(passkeyId) =>
                        handler.requestDestructiveAction('remove', passkeyId)
                    }
                />
            )}
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
                onConfirm={(name) => void handler.confirmPasskeyName(name)}
                onClose={handler.closePasskeyName}
            />
            <ReauthenticationModal
                open={state.reauthAction !== null}
                isPending={state.isReauthenticationPending || state.isPending}
                value={state.reauthenticationCredential}
                onChange={setter.setReauthenticationCredential}
                onConfirm={() => void handler.confirmReauthentication()}
                onPasskey={() => void handler.reauthenticateWithPasskey()}
                onClose={handler.closeReauthentication}
                onOpenChange={handler.handleReauthenticationOpenChange}
            />
            <ConfirmDialog
                open={state.confirmation !== null}
                onOpenChange={handler.handleConfirmationOpenChange}
                title={state.confirmationTitle}
                description={state.confirmationDescription}
                confirmLabel={state.confirmationLabel}
                pendingLabel={t('account.confirmation.applying')}
                destructive
                isPending={state.isPending}
                onConfirm={handler.confirmDestructiveAction}
            />
        </>
    )
}
