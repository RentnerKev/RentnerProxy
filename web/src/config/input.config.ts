import type { InputProviderProps } from '@rentnerkev/inputs'

export const INPUT_PROVIDER_PROPS = {
    validationMode: 'external',
    classNames: {
        input: 'box-border h-12 w-full rounded-xl text-sm motion-reduce:transition-none',
        textarea:
            'box-border min-h-26 w-full resize-y rounded-xl py-3 text-sm motion-reduce:transition-none',
        checkbox: 'mt-[0.12rem] size-4 accent-brand-600',
        radio: 'size-4 accent-brand-600',
        range: 'w-full accent-brand-600',
        file: 'block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-surface-raised file:px-3 file:py-2 file:font-semibold file:text-ink-soft hover:file:border-brand-600',
    },
    customDesign: {
        bg: 'bg-surface-raised',
        border: 'border-input-border',
        text: 'text-ink',
        labelText: 'text-ink-soft',
        placeholder: 'placeholder:text-ink',
        focusRing: 'focus:ring-brand-500/20',
        focusBorder: 'focus:border-brand-600',
        errorBorder: 'border-red-500',
        errorRing: 'focus:ring-red-500/20',
        errorText: 'text-danger-text',
        iconColor: 'text-muted',
        iconFocus: 'group-focus-within:text-brand-text',
        counterBg: 'bg-surface-raised',
        counterText: 'text-brand-text',
        counterBorderFocus: 'peer-focus:border-brand-600',
        passwordStrengthTrack: 'bg-border',
        passwordStrengthText: 'text-muted',
        passwordStrengthWeak: 'bg-red-500',
        passwordStrengthFair: 'bg-orange-500',
        passwordStrengthGood: 'bg-lime-500',
        passwordStrengthStrong: 'bg-brand-500',
    },
} satisfies Omit<InputProviderProps, 'children' | 'locale'>
