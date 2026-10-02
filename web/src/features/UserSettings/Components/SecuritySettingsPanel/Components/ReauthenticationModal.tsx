import type { ReauthenticationModalProps } from '../Types/reauthentication-modal.types.ts'
import { PasswordInput } from '@rentnerkev/inputs'
import { Modal } from '@/shared/Modal/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function ReauthenticationModal({
    open,
    isPending,
    value,
    onChange,
    onConfirm,
    onPasskey,
    onClose,
    onOpenChange,
}: ReauthenticationModalProps) {
    const { t } = useTranslationStore()

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title={t('account.reauthentication.title')}
            description={t('account.reauthentication.description')}
            closeDisabled={isPending}
            footer={
                <>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                        disabled={isPending}
                        onClick={onClose}
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                        disabled={isPending || !value}
                        onClick={onConfirm}
                    >
                        {t('account.reauthentication.confirm')}
                    </button>
                </>
            }
        >
            <div className="grid gap-4">
                <label className="grid gap-[0.45rem]" htmlFor="reauth-password">
                    <span className="text-[0.82rem] font-[750] text-ink-soft">
                        {t('account.reauthentication.currentPassword')}
                    </span>
                    <PasswordInput
                        id="reauth-password"
                        autoComplete="current-password"
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                    />
                </label>
                <button
                    type="button"
                    className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-transparent text-muted enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                    disabled={isPending}
                    onClick={onPasskey}
                >
                    {t('account.reauthentication.usePasskey')}
                </button>
            </div>
        </Modal>
    )
}
