import { Eye, EyeOff } from 'lucide-react'

import { uiClassNames } from '../../Styles/uiClassNames'
import usePasswordInputLogic from './Hooks/usePasswordInputLogic'
import type { PasswordInputProps } from './Types/password-input.types'

export default function PasswordInput(inputProps: PasswordInputProps) {
    const { state, handler } = usePasswordInputLogic()
    const { className, ...restInputProps } = inputProps

    return (
        <div className="relative">
            <input
                {...restInputProps}
                className={`${uiClassNames.form.control} pr-[3.35rem]${className ? ` ${className}` : ''}`}
                type={state.inputType}
            />
            <button
                type="button"
                className="absolute top-1/2 right-[0.05rem] inline-grid size-[2.75rem] -translate-y-1/2 place-items-center rounded-[0.7rem] border-0 bg-transparent p-0 text-muted hover:bg-code hover:text-brand-text focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-brand-600"
                aria-controls={inputProps.id}
                aria-label={state.toggleLabel}
                aria-pressed={state.isPasswordVisible}
                title={state.toggleLabel}
                onMouseDown={handler.keepInputFocused}
                onClick={handler.toggleVisibility}
            >
                {state.isPasswordVisible ? (
                    <EyeOff aria-hidden="true" className="size-[1.2rem]" strokeWidth={1.8} />
                ) : (
                    <Eye aria-hidden="true" className="size-[1.2rem]" strokeWidth={1.8} />
                )}
            </button>
        </div>
    )
}

export type { PasswordInputProps } from './Types/password-input.types'
