import type { ButtonHTMLAttributes } from 'react'

export interface ModalActionButtonProps extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'className'
> {
    readonly variant?: 'primary' | 'secondary' | 'danger'
}

export type ModalCancelButtonProps = Omit<ModalActionButtonProps, 'variant'>

export interface ModalSaveButtonProps extends Omit<ModalActionButtonProps, 'children' | 'variant'> {
    readonly isPending?: boolean
}
