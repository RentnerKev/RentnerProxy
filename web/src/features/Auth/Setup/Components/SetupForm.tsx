import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import StringFormField from '@/shared/Forms/StringFormField.tsx'
import FormSubmitButton from '@/shared/Forms/FormSubmitButton.tsx'
import type { SetupFormProps } from '../Types/setup-component-props.types.ts'

export default function SetupForm({ state, form, handler }: SetupFormProps) {
    const { t } = useTranslationStore()

    return (
        <form
            method="post"
            className="mt-7 grid gap-[1.1rem]"
            noValidate
            onSubmit={handler.handleSubmit}
        >
            <form.Field name="displayName" validators={{ onBlur: handler.validateDisplayName }}>
                {(field) => (
                    <StringFormField
                        field={field}
                        placeholder={t('placeholders.displayName')}
                        label="Display name"
                        kind="text"
                        autoComplete="name"
                        maxLength={100}
                    />
                )}
            </form.Field>
            <form.Field name="email" validators={{ onBlur: handler.validateEmail }}>
                {(field) => (
                    <StringFormField
                        field={field}
                        placeholder={t('placeholders.email')}
                        label="Email address"
                        kind="email"
                        autoComplete="email"
                        maxLength={254}
                    />
                )}
            </form.Field>
            <form.Field name="password" validators={{ onBlur: handler.validatePassword }}>
                {(field) => (
                    <StringFormField
                        field={field}
                        placeholder={t('placeholders.newPassword')}
                        label="Password"
                        kind="password"
                        autoComplete="new-password"
                        maxLength={256}
                        showPasswordStrength
                    />
                )}
            </form.Field>
            <form.Field
                name="confirmPassword"
                validators={{ onBlur: handler.validateConfirmPassword }}
            >
                {(field) => (
                    <StringFormField
                        field={field}
                        placeholder={t('placeholders.confirmPassword')}
                        label="Confirm password"
                        kind="password"
                        autoComplete="new-password"
                        maxLength={256}
                    />
                )}
            </form.Field>
            <form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <FormSubmitButton
                        canSubmit={canSubmit}
                        isSubmitting={isSubmitting}
                        isPending={state.isPending}
                        submitLabel="Create owner"
                        pendingSubmitLabel="Creating owner…"
                    />
                )}
            </form.Subscribe>
        </form>
    )
}
