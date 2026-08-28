import { useState } from 'react'
import type { ComponentPropsWithoutRef, MouseEvent } from 'react'

import { uiClassNames } from '../Styles/uiClassNames'

type PasswordInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'type'>

export default function PasswordInput(inputProps: PasswordInputProps) {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false)
    const toggleLabel = isPasswordVisible ? 'Hide password' : 'Show password'
    const { className, ...restInputProps } = inputProps

    return (
        <div className="relative">
            <input
                {...restInputProps}
                className={`${uiClassNames.form.control} pr-[3.35rem]${className ? ` ${className}` : ''}`}
                type={isPasswordVisible ? 'text' : 'password'}
            />
            <button
                type="button"
                className="absolute top-1/2 right-[0.05rem] inline-grid size-[2.75rem] -translate-y-1/2 place-items-center rounded-[0.7rem] border-0 bg-transparent p-0 text-muted hover:bg-code hover:text-brand-text focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-brand-600"
                aria-controls={inputProps.id}
                aria-label={toggleLabel}
                aria-pressed={isPasswordVisible}
                title={toggleLabel}
                onMouseDown={keepInputFocused}
                onClick={() => setIsPasswordVisible((isVisible) => !isVisible)}
            >
                {isPasswordVisible ? <EyeOffIcon /> : <EyeIcon />}
            </button>
        </div>
    )
}

function keepInputFocused(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
}

function EyeIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className="size-[1.2rem]"
        >
            <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
            <circle cx="12" cy="12" r="2.75" />
        </svg>
    )
}

function EyeOffIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className="size-[1.2rem]"
        >
            <path d="M3 3l18 18" />
            <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6.1 0 9.5 6 9.5 6a15 15 0 0 1-2.1 2.8" />
            <path d="M6.2 6.2C3.8 8 2.5 12 2.5 12s3.4 6 9.5 6a9.7 9.7 0 0 0 3.2-.5" />
        </svg>
    )
}
