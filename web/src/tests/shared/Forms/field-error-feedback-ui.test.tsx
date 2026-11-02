import { expect, spyOn, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { useForm } from '@tanstack/react-form'
import { InputProvider } from '@rentnerkev/inputs'
import { TooltipProvider } from '@rentnerkev/tooltips/tooltip'
import { z } from 'zod'
import useValidationFeedback from '@/shared/Forms/Hooks/useValidationFeedback.ts'
import StringFormField from '@/shared/Forms/StringFormField.tsx'
import { TOAST_PROVIDER_PROPS } from '@/config/toast.config.ts'
import withTestLanguage from '@/tests/Helpers/withTestLanguage.tsx'

if (!GlobalRegistrator.isRegistered)
    GlobalRegistrator.register({ settings: { device: { prefersReducedMotion: 'reduce' } } })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { act, useEffect, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ToastProvider, toast } = await import('@rentnerkev/toasts')

function useProbeForm() {
    const feedback = useValidationFeedback()
    const form = useForm({
        defaultValues: { email: '', password: 'valid password' },
        validators: {
            onSubmit: z.object({ email: z.email('Enter a valid email.'), password: z.string() }),
        },
        listeners: {
            onBlur: ({ fieldApi }) => feedback.handler.handleValidationCompleted([fieldApi.name]),
        },
        onSubmitInvalid: () => feedback.handler.handleValidationCompleted(['email', 'password']),
    })
    return { form, feedback }
}
let probe: ReturnType<typeof useProbeForm> | undefined
function Form({ revision }: { readonly revision: number }) {
    const logic = useProbeForm()
    const { form, feedback } = logic
    useEffect(() => {
        probe = logic
    }, [logic])
    return (
        <form
            data-revision={revision}
            onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
            }}
        >
            <form.Field
                name="email"
                validators={{
                    onBlur: ({ value }) =>
                        value.includes('@') ? undefined : 'Enter a valid email.',
                }}
            >
                {(field) => (
                    <StringFormField
                        field={field}
                        label="Email"
                        placeholder="Email"
                        maxLength={254}
                        kind="email"
                        errorFeedback="toast"
                        validationEpoch={feedback.state.validationEpochs.email ?? 0}
                    />
                )}
            </form.Field>
            <form.Field name="password">
                {(field) => (
                    <StringFormField
                        field={field}
                        label="Password"
                        placeholder="Password"
                        maxLength={256}
                        errorFeedback="toast"
                        validationEpoch={feedback.state.validationEpochs.password ?? 0}
                    />
                )}
            </form.Field>
            <button type="submit">Sign in</button>
        </form>
    )
}

test('fresh TanStack validation repeats a dismissed toast while unrelated rendering preserves its error identity', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const error = spyOn(toast, 'error')
    function render(revision: number) {
        root.render(
            withTestLanguage(
                <StrictMode>
                    <TooltipProvider>
                        <InputProvider locale="en">
                            <Form revision={revision} />
                            <ToastProvider {...TOAST_PROVIDER_PROPS} locale="en">
                                {null}
                            </ToastProvider>
                        </InputProvider>
                    </TooltipProvider>
                </StrictMode>,
            ),
        )
    }
    try {
        await act(async () => render(0))
        await act(async () => {
            await probe!.form.handleSubmit()
        })
        const firstErrors = probe!.form.getFieldMeta('email')!.errors
        expect(error).toHaveBeenCalledTimes(1)
        expect(document.body.textContent).toContain(error.mock.calls[0]![0])
        const input = container.querySelector<HTMLInputElement>('input[name="email"]')!
        await act(async () => input.focus())
        expect(document.activeElement === input).toBeTrue()
        const description = document.getElementById(input.getAttribute('aria-describedby')!)!
        expect(description.id).toBe('email-error')
        expect(description.className).toBe('sr-only')
        expect(description.hasAttribute('role')).toBeFalse()
        expect(container.querySelector('p[role="alert"]')).toBeNull()
        expect(container.querySelectorAll('#email-error')).toHaveLength(1)
        await act(async () => {
            probe!.form.setFieldValue('password', 'changed password')
            container
                .querySelector<HTMLInputElement>('input[name="password"]')!
                .dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
            await probe!.form.validateField('password', 'blur')
            render(1)
        })
        expect(probe!.form.getFieldMeta('email')!.errors === firstErrors).toBeTrue()
        expect(error).toHaveBeenCalledTimes(1)
        await act(async () => {
            toast.dismissAll()
            await new Promise((resolve) => setTimeout(resolve, 1_050))
        })
        expect(document.querySelector('.rentnerproxy-toast')).toBeNull()
        await act(async () => {
            await probe!.form.handleSubmit()
        })
        // TanStack structurally shares identical error arrays across validation cycles.
        expect(probe!.form.getFieldMeta('email')!.errors === firstErrors).toBeTrue()
        expect(error).toHaveBeenCalledTimes(2)
        expect(error.mock.calls[1]?.[0]).toBe(error.mock.calls[0]?.[0])
        expect(document.querySelector('.rentnerproxy-toast')?.textContent).toContain(
            error.mock.calls[0]![0],
        )
        expect(container.querySelectorAll('#email-error')).toHaveLength(1)
        await act(async () => {
            toast.dismissAll()
            await new Promise((resolve) => setTimeout(resolve, 1_050))
        })
        await act(async () => {
            input.focus()
            input.blur()
        })
        expect(error).toHaveBeenCalledTimes(3)
        expect(document.querySelector('.rentnerproxy-toast')?.textContent).toContain(
            'Enter a valid email.',
        )
    } finally {
        error.mockRestore()
        await act(async () => {
            toast.dismissAll()
            root.unmount()
        })
        container.remove()
        probe = undefined
    }
})
