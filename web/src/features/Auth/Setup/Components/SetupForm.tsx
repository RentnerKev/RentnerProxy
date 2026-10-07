import { EmailInput, PasswordInput, TextInput } from '@rentnerkev/inputs'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { SetupFormProps } from '../Types/setup-component-props.types.ts'

export default function SetupForm({ state, form, handler }: SetupFormProps) {
    return (
        <form
            method="post"
            className="mt-7 grid gap-[1.1rem]"
            noValidate
            onSubmit={handler.handleSubmit}
        >
            <form.Field name="displayName" validators={{ onBlur: handler.validateDisplayName }}>
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Display name
                        </label>
                        <TextInput
                            id={field.name}
                            name={field.name}
                            autoComplete="name"
                            maxLength={100}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby={`${field.name}-error`}
                        />
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </form.Field>
            <form.Field name="email" validators={{ onBlur: handler.validateEmail }}>
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Email address
                        </label>
                        <EmailInput
                            id={field.name}
                            name={field.name}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            maxLength={254}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby={`${field.name}-error`}
                        />
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </form.Field>
            <form.Field name="password" validators={{ onBlur: handler.validatePassword }}>
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Password
                        </label>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="new-password"
                            showPasswordStrength
                            maxLength={256}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby={`${field.name}-error`}
                        />
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </form.Field>
            <form.Field
                name="confirmPassword"
                validators={{ onBlur: handler.validateConfirmPassword }}
            >
                {(field) => (
                    <div className="grid gap-[0.45rem]">
                        <label
                            className="text-[0.82rem] font-[750] text-ink-soft"
                            htmlFor={field.name}
                        >
                            Confirm password
                        </label>
                        <PasswordInput
                            id={field.name}
                            name={field.name}
                            autoComplete="new-password"
                            maxLength={256}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onValueChange={field.handleChange}
                            aria-describedby={`${field.name}-error`}
                        />
                        <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                    </div>
                )}
            </form.Field>
            <form.Subscribe
                selector={(formState) => [formState.canSubmit, formState.isSubmitting] as const}
            >
                {([canSubmit, isSubmitting]) => (
                    <button
                        type="submit"
                        className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover"
                        disabled={!canSubmit || isSubmitting || state.isPending}
                    >
                        {isSubmitting || state.isPending ? 'Creating owner…' : 'Create owner'}
                    </button>
                )}
            </form.Subscribe>
        </form>
    )
}
