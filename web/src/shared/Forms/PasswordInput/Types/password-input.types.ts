import type { ComponentPropsWithoutRef } from 'react'

export type PasswordInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'>
