import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type {
    ModalActionButtonProps,
    ModalCancelButtonProps,
    ModalSaveButtonProps,
} from '../Types/modal-actions.types.ts'

export function ModalActionButton({
    variant = 'primary',
    type = 'button',
    ...props
}: ModalActionButtonProps) {
    return <button {...props} type={type} className={buttonClassName(variant)} />
}

export function ModalCancelButton({ children, ...props }: ModalCancelButtonProps) {
    const { t } = useTranslationStore()
    return (
        <ModalActionButton {...props} variant="secondary">
            {children ?? t('common.cancel')}
        </ModalActionButton>
    )
}

export function ModalSaveButton({
    isPending = false,
    disabled,
    type = 'submit',
    ...props
}: ModalSaveButtonProps) {
    const { t } = useTranslationStore()
    return (
        <ModalActionButton
            {...props}
            type={type}
            disabled={disabled || isPending}
            aria-busy={isPending || undefined}
        >
            {t(isPending ? 'common.saving' : 'common.save')}
        </ModalActionButton>
    )
}
